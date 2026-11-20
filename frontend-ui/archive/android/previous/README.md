# AI Glasses 安卓用户端

面向眼镜使用者的独立应用。免登录，演示数据随应用安装，无需启动管理后台、连接网络或授权蓝牙、相机、麦克风和位置。

## 安装与操作

使用现成的 [AI Glasses 用户端测试 APK](../../downloads/AI-Glasses-Android-User-debug.apk)，无需配置开发工具。

1. 把测试 APK 安装到安卓手机，或导入腾讯应用宝的移动应用引擎。Windows 若已将 APK 关联到腾讯引擎，可以直接双击 APK。已经通过 ADB 连接设备时，也可运行 `adb install -r <APK路径>`。
2. 打开 **AI Glasses 用户端**，进入 **设备 → 连接模拟眼镜**。如需展示异常流程，先点 **演示连接失败**，再点 **重试连接**。
3. 回到 **首页**，分别体验字幕、环境声音识别、环境识别、OCR、导航定位和 AI 问答。听觉演示会在开始后显示两条示例，可提前停止。演示路线不用于实际出行。
4. **记录**可以按功能筛选、清空。本机会保存最近 120 条结果摘要，不保存原始音视频、定位轨迹或提问原文。
5. **设置**可切换主题或关闭自动朗读。环境识别、OCR 和导航会在前台默认朗读新结果，需要手机有可用的离线简体中文语音。启用系统屏幕朗读时，App 不重复外放。

## 本地运行

在 PowerShell 中运行：

```powershell
cd D:\Code\ProjectUI\apps\android-user
npm.cmd ci
npm.cmd run dev
```

浏览器打开 http://127.0.0.1:5174/。浏览器可以预览界面和演示流程；系统朗读、Android 返回键和系统字体联动请在 Android App 验证。

## 构建 Windows 上的 Android 测试包

使用 Node.js 24、JDK 21、Android SDK Platform 36 和 Android SDK Build Tools 36.0.0。在当前终端设置 `ANDROID_HOME` 和 `JAVA_HOME`。已有腾讯模拟器即可用于尝试安装，不需要另装模拟器。详见 [Capacitor 环境要求](https://capacitorjs.com/docs/getting-started/environment-setup)。

```powershell
npm.cmd test
npm.cmd run android:apk
```

默认 APK 生成在 `android/app/build/outputs/apk/debug/app-debug.apk`。这是本地演示测试包，没有配置商店发布签名。

## 后续接入真实眼镜

`GlassesClient` 定义连接、断开、一次性请求和事件订阅。拿到样机型号、固件、配对与鉴权方式、服务接口以及响应示例后，再实现真实客户端。真机失败应报告真实错误；模拟和真机结果应分别标注来源。
