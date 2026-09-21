@echo off
REM ===========================================================================
REM  GIU CUA SO LAI NEU CO SU CO
REM  ---------------------------------------------------------------------
REM  Khi cmd.exe gap loi cu phap, no bo chay ca file va DONG CUA SO NGAY -
REM  nguoi dung khong kip doc mot chu nao, nhat ky cung khong ghi kip. Da xay
REM  ra that o ban 2.6.1: cua so tu bien mat o buoc [4/6].
REM
REM  Nen lan chay dau tu goi lai chinh minh trong mot cua so con. Cua so con
REM  co chet the nao thi cua so cha van con day, mang theo dong bao loi.
REM ===========================================================================
if "%~1"=="--trong" goto :chinh
cmd /c ""%~f0" --trong"
set "RC=%ERRORLEVEL%"
if "%RC%"=="0" exit /b 0
echo.
echo ========================================================
echo   Cua so giu lai de ban doc duoc thong bao o tren.
echo   Neu khong thay dong nao, hay chup ca cua so nay gui di.
echo ========================================================
pause
exit /b %RC%

:chinh
setlocal EnableDelayedExpansion
title Flow Automation Studio

REM ===========================================================================
REM  CHAY_TU_NGUON.bat - chay app thang tu ma nguon, KHONG can build .exe
REM  ---------------------------------------------------------------------
REM  Duong nay it hong nhat. Neu BUILD_EXE.bat that bai tren may ban thi dung
REM  file nay - hau nhu luc nao cung chay duoc.
REM
REM  Node.js thieu thi CAI_NODEJS.bat lo, khong bat ban di tim.
REM
REM  SUA O BAN 2.6.0: bo "chcp 65001" va bo "set /p BIEN=<file".
REM  Hai thu do lam script dung im cho go phim o buoc kiem tra Node.js, va
REM  bam Enter thi bien rong nen may DA CO Node.js van bi bao la chua co.
REM  Chi tiet ghi trong CAI_NODEJS.bat.
REM ===========================================================================

set "HERE=%~dp0"
cd /d "%HERE%"
set "LOG=%HERE%CHAY_LOG.txt"

echo Bat dau: %DATE% %TIME% > "%LOG%"

echo.
echo ========================================================
echo   FLOW AUTOMATION STUDIO
echo ========================================================
echo.

REM --- Node.js ---------------------------------------------------------------
call "%HERE%CAI_NODEJS.bat"
if !ERRORLEVEL! NEQ 0 exit /b 1

REM Cua so nay va cua so cua CAI_NODEJS.bat la hai moi truong rieng, nen PATH
REM no vua nap lai KHONG theo sang day duoc. Nap lai them mot lan o day.
call :nap_path

set "NODEVER="
for /f "delims=" %%V in ('node -v 2^>nul') do if not defined NODEVER set "NODEVER=%%V"

if not defined NODEVER (
    echo.
    echo   [*] Node.js vua duoc cai nhung cua so nay chua nhan.
    echo       Hay DONG cua so nay va mo lai file CHAY_TU_NGUON.bat.
    echo.
    pause
    exit /b 1
)
echo   Node.js !NODEVER!
echo   Node !NODEVER! >> "%LOG%"

REM --- Thu vien --------------------------------------------------------------
REM  Dieu kien "da cai xong" phai la mot file THAT SU can den luc chay, khong
REM  phai chi la thu muc node_modules co ton tai: mot lan npm install dut giua
REM  chung van de lai thu muc do, va app se chet voi loi kho hieu.
if not exist "node_modules\electron\package.json" (
    echo.
    echo   Lan dau chay - dang cai thu vien, mat 3-10 phut...
    echo   ^(tai khoang 250 MB, can mang^)
    echo.
    call npm install --no-audit --no-fund >>"%LOG%" 2>&1
    if !ERRORLEVEL! NEQ 0 (
        echo.
        echo   [X] Cai thu vien that bai. 25 dong cuoi:
        echo.
        powershell -NoProfile -Command "Get-Content -Tail 25 '%LOG%'" 2>nul
        echo.
        echo   Hay thu: tat VPN, doi mang, roi chay lai.
        echo.
        pause
        exit /b 1
    )
)

echo.
echo   Dang mo app...
echo.
call npx electron . >>"%LOG%" 2>&1
set "RC=!ERRORLEVEL!"

if !RC! NEQ 0 (
    echo.
    echo   App dong lai voi ma loi !RC!. 25 dong cuoi cua nhat ky:
    echo.
    powershell -NoProfile -Command "Get-Content -Tail 25 '%LOG%'" 2>nul
    echo.
    pause
)
exit /b !RC!

REM ===========================================================================
:nap_path
set "USERPATH="
for /f "tokens=2,*" %%A in ('reg query "HKCU\Environment" /v PATH 2^>nul ^| findstr /i "REG_"') do set "USERPATH=%%B"
if defined USERPATH set "PATH=!PATH!;!USERPATH!"
set "PATH=!PATH!;%ProgramFiles%\nodejs;%LOCALAPPDATA%\Programs\nodejs;%APPDATA%\npm"
exit /b 0
