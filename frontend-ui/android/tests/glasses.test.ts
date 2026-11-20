import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DemoGlassesClient, demoQuestions, demoStreamLineCount, featureIds, featureInfo } from '../src/glasses.ts'
import type { GlassesResult } from '../src/glasses.ts'

test('a connection is required for requests and streams; a failed demo connection grants neither', async ({ mock }) => {
  mock.timers.enable({ apis: ['setTimeout'] })
  const client = new DemoGlassesClient({ failConnect: true })
  const failure = assert.rejects(client.connect(), /模拟连接失败/)
  mock.timers.tick(500)
  await failure
  await assert.rejects(client.run('environment'), /先连接/)

  const results: GlassesResult[] = []
  const errors: Error[] = []
  const stop = client.subscribe('speech', (result) => results.push(result), (error) => errors.push(error))
  mock.timers.tick(2500)
  stop()
  assert.equal(results.length, 0)
  assert.equal(errors.length, 1)
  assert.match(errors[0].message, /先连接/)
})

test('one-shot features return labeled mock results and Q&A stays inside the example scene', async ({ mock }) => {
  mock.timers.enable({ apis: ['setTimeout'] })
  const client = new DemoGlassesClient()
  const connecting = client.connect()
  mock.timers.tick(500)
  await connecting

  const responses = Promise.all([
    client.run('environment'), client.run('ocr'), client.run('navigation'),
    ...demoQuestions.map((question) => client.run('qa', question)),
    client.run('qa', '北京明天会下雨吗？'),
  ])
  mock.timers.tick(500)
  const [objects, text, location, objectsAnswer, textAnswer, locationAnswer, unsupported] = await responses

  assert.deepEqual(featureIds.map((id) => featureInfo[id].mode), ['one-shot', 'stream', 'stream', 'one-shot', 'one-shot', 'one-shot'])
  assert.deepEqual([objects.id, text.id, location.id, objectsAnswer.id], ['environment', 'ocr', 'navigation', 'qa'])
  assert.match(objects.text, /水杯/)
  assert.match(text.text, /样机演示区\n请勿触碰展品/)
  assert.match(location.text, /虚构.+不能用于实际导航/)
  assert.equal(objectsAnswer.text, objects.text)
  assert.match(textAnswer.text, /请勿触碰展品/)
  assert.equal(locationAnswer.text, location.text)
  assert.match(unsupported.text, /只回答内置场景的问题/)
  for (const result of await responses) {
    assert.equal(result.source, 'mock')
    assert.equal(new Date(result.timestamp).toISOString(), result.timestamp)
  }
  await assert.rejects(client.run('qa', '   '), /请输入/)
})

test('streams emit two distinct lines only while subscribed and stop on disconnect', async ({ mock }) => {
  mock.timers.enable({ apis: ['setTimeout'] })
  const client = new DemoGlassesClient()
  const connecting = client.connect()
  mock.timers.tick(500)
  await connecting

  const speech: GlassesResult[] = []
  const sound: GlassesResult[] = []
  const errors: Error[] = []
  const rememberError = (error: Error) => errors.push(error)
  const stopSpeech = client.subscribe('speech', (result) => speech.push(result), rememberError)
  const stopSound = client.subscribe('sound', (result) => sound.push(result), rememberError)
  assert.deepEqual([speech.length, sound.length], [0, 0])
  mock.timers.tick(600)
  assert.deepEqual([speech.length, sound.length], [1, 1])
  stopSpeech()
  stopSpeech()
  mock.timers.tick(2500)
  assert.equal(speech.length, 1)
  assert.equal(speech[0].id, 'speech')
  assert.equal(sound.length, demoStreamLineCount)
  assert.match(sound[0].text, /门铃/)
  assert.match(sound[1].text, /广播/)
  assert.ok(sound.every((line) => line.id === 'sound' && line.source === 'mock'))
  stopSound()

  client.subscribe('speech', (result) => speech.push(result), rememberError)
  await client.disconnect()
  mock.timers.tick(2500)
  assert.equal(speech.length, 1)
  assert.deepEqual(errors, [])
  await assert.rejects(client.run('ocr'), /先连接/)
})

test('disconnect cancels an in-flight connect or one-shot even if the device reconnects', async ({ mock }) => {
  mock.timers.enable({ apis: ['setTimeout'] })
  const client = new DemoGlassesClient()
  const firstConnect = assert.rejects(client.connect(), /已取消/)
  await client.disconnect()
  const secondConnect = client.connect()
  mock.timers.tick(500)
  await Promise.all([firstConnect, secondConnect])

  const run = assert.rejects(client.run('ocr'), /已断开/)
  await client.disconnect()
  const thirdConnect = client.connect()
  mock.timers.tick(500)
  await Promise.all([run, thirdConnect])

  const fresh = client.run('ocr')
  mock.timers.tick(500)
  assert.match((await fresh).text, /演示区/)
})
