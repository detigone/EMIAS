@echo off
chcp 65001 >nul
title ЕМИАС
echo Запуск сервера и Discord-бота...
start "ЕМИАС: сервер" cmd /k "npm start"
timeout /t 2 >nobreak >nul
start "ЕМИАС: бот" cmd /k "npm run bot"
echo Готово. Сайт: http://localhost:3000
