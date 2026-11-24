@echo off
chcp 65001 >nul
title AI Glasses Backend - Conda glasses
set "CONDA_BAT=%USERPROFILE%\anaconda3\condabin\conda.bat"
if not exist "%CONDA_BAT%" (
  echo 未找到 Conda: %CONDA_BAT%
  pause
  exit /b 1
)
call "%CONDA_BAT%" activate glasses
if errorlevel 1 (
  echo 无法激活 Conda 环境 glasses。
  pause
  exit /b 1
)
cd /d "%~dp0"
echo 正在 glasses 环境启动后端，监听 0.0.0.0:8081。按 Ctrl+C 停止。
python app_main.py
if errorlevel 1 echo 后端退出，请检查上方错误信息。
pause