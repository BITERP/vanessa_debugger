@echo off
chcp 1251

cd %UserProfile%\.vscode\extensions

IF EXIST "vanessa_debugger\" (
  cd vanessa_debugger
  git pull && npm install
  msg %username% Extention Vanessa Debugger updated
) ELSE (
  git clone https://github.com/BITERP/vanessa_debugger.git
  cd vanessa_debugger
  npm install
  msg %username% Extention Vanessa Debugger installed
)


