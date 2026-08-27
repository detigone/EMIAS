@echo off
chcp 65001 >nul
title ЕМИАС — запуск сервера
echo.
echo Запуск API-шлюза ЕМИАС (веб-сайт)...
echo Откройте в браузере: http://localhost:3000
echo.
echo (Discord-бот — отдельный репозиторий, запускается самостоятельно)
echo.
npm start
