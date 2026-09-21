@echo off
setlocal EnableDelayedExpansion
title Flow Automation Studio - Kiem tra va cai Node.js

REM ===========================================================================
REM  CAI_NODEJS.bat - TU KIEM TRA VA CAI NODE.JS
REM  ---------------------------------------------------------------------
REM  Hai file CHAY_TU_NGUON.bat va BUILD_EXE.bat deu goi file nay truoc.
REM  Ban cung co the bam thang vao day neu chi muon cai Node.js.
REM
REM  QUY TAC O DAY:
REM
REM    1. KHONG dung "set /p BIEN=<file" de doc ket qua ra bien.
REM       Day la LOI CUA BAN 2.5.0. Khi file rong (hoac chua ghi xong), lenh
REM       "set /p" KHONG bao loi - no quay ra CHO NGUOI DUNG GO PHIM, man hinh
REM       dung im khong mot chu nao. Nguoi dung tuong may treo; bam Enter thi
REM       bien rong, roi moi buoc sau deu sai theo: may DA CO Node.js van bi
REM       bao la chua co, va van tai bo cai ve.
REM       Thay bang "for /f" - lenh nay doc ket qua cua chuong trinh, khong bao
REM       gio quay ra doi ban go phim.
REM
REM    2. KHONG dung "chcp 65001". Ban cu co dong do. Ma trang UTF-8 lam hong
REM       chinh cai "set /p" o tren (loi co san cua cmd.exe tu nhieu doi
REM       Windows). Moi chu trong cac file .bat nay deu la chu khong dau, nen
REM       ma trang mac dinh hien dung het - khong can 65001 lam gi.
REM
REM    3. KHONG dung "where node". Windows tra ve ca file stub khong chay duoc
REM       (App Execution Aliases), nen "tim thay" van co the la khong dung duoc.
REM       Cach duy nhat dang tin la GOI THU "node -v" roi doc ket qua.
REM
REM    4. Sau khi cai xong PHAI nap lai PATH trong chinh cua so nay. Trinh cai
REM       dat Node.js chi sua PATH trong registry; cua so cmd dang mo van giu
REM       PATH cu, nen neu khong nap lai thi vua cai xong van bao "khong thay".
REM
REM  Ma tra ve:  0 = Node.js dung duoc   1 = khong cai duoc
REM ===========================================================================

set "HERE=%~dp0"
set "LOG=%HERE%CAI_NODEJS_LOG.txt"
set "MIN_MAJOR=18"

echo ======================================================== > "%LOG%"
echo  Kiem tra Node.js - %DATE% %TIME%                       >> "%LOG%"
echo ======================================================== >> "%LOG%"

call :kiem_tra
if "!NODE_OK!"=="1" (
    echo   Node.js !NODEVER! - dung duoc.
    echo   OK: !NODEVER! >> "%LOG%"
    exit /b 0
)

echo.
echo ========================================================
echo   CHUA CO NODE.JS - APP CAN NO DE CHAY
echo ========================================================
echo.
echo   Node.js la bo cong cu mien phi cua OpenJS Foundation.
echo   App nay chay tren no, giong nhu file .docx can Word.
echo.
echo   Script se tai bo cai chinh chu tu  https://nodejs.org
echo   ^(khoang 30 MB^) roi cai dat giup ban.
echo.
echo   Neu ban CHAC CHAN may da co Node.js roi ma van thay dong nay,
echo   hay mo file CAI_NODEJS_LOG.txt xem dong ghi ly do.
echo.

REM  Doc tu ban phim - "set /p" doc tu CONSOLE thi binh thuong, chi doc tu
REM  FILE moi la cho chet. Cho nen dong nay giu nguyen.
set /p "DONGY=  Cho phep tai va cai Node.js? (C/k): "
if /i "!DONGY!"=="k" goto :tu_cai
if /i "!DONGY!"=="n" goto :tu_cai

REM ---------------------------------------------------------------------------
REM  Tai bo cai
REM  ---------------------------------------------------------------------
REM  Doc ten file moi nhat tu thu muc latest-v22.x cua nodejs.org nen khong
REM  phai sua so phien ban trong file nay moi lan Node ra ban moi.
REM ---------------------------------------------------------------------------
echo.
echo   [1/3] Dang tai bo cai Node.js LTS...
echo   [1/3] Tai bo cai >> "%LOG%"

set "MSI=%TEMP%\nodejs-lts-x64.msi"
if exist "!MSI!" del /f /q "!MSI!" >nul 2>&1

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='Stop';" ^
  "[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12;" ^
  "$base='https://nodejs.org/dist/latest-v22.x/';" ^
  "$html=(Invoke-WebRequest -UseBasicParsing -Uri $base).Content;" ^
  "$m=[regex]::Match($html,'node-v[0-9\.]+-x64\.msi');" ^
  "if(-not $m.Success){throw 'Khong doc duoc ten file tren nodejs.org'};" ^
  "Invoke-WebRequest -UseBasicParsing -Uri ($base+$m.Value) -OutFile '%MSI%';" ^
  "Write-Host ('   Da tai: '+$m.Value)" >>"%LOG%" 2>&1

if not exist "!MSI!" (
    echo   [X] Tai that bai - co the may dang chan mang hoac khong co Internet.
    echo   Tai that bai >> "%LOG%"
    goto :tu_cai
)
echo       OK

REM ---------------------------------------------------------------------------
REM  Cai dat
REM  ---------------------------------------------------------------------
REM  /qb = co thanh tien trinh nhung khong hoi gi. Cai cho RIENG NGUOI DUNG
REM  (ALLUSERS=) de khong can quyen Administrator - nguoi dung binh thuong
REM  bam vao file .bat thi khong co quyen do.
REM ---------------------------------------------------------------------------
echo.
echo   [2/3] Dang cai dat ^(dung tat cua so, cho 1-3 phut^)...
echo   [2/3] msiexec >> "%LOG%"

msiexec /i "!MSI!" /qb ALLUSERS= ADDLOCAL=ALL >>"%LOG%" 2>&1
set "RC=!ERRORLEVEL!"
echo       msiexec tra ve !RC! >> "%LOG%"

if not "!RC!"=="0" (
    if "!RC!"=="1602" (
        echo   [X] Ban da bam Huy trong cua so cai dat.
    ) else if "!RC!"=="1603" (
        echo   [X] Trinh cai dat bao loi 1603 - thuong la can quyen Administrator.
        echo       Hay bam chuot phai vao file nay, chon "Run as administrator".
    ) else (
        echo   [X] Cai dat that bai ^(ma !RC!^).
    )
    goto :tu_cai
)

REM ---------------------------------------------------------------------------
REM  Nap lai PATH trong chinh cua so nay
REM  ---------------------------------------------------------------------
REM  DAY LA BUOC HAY BI QUEN. Trinh cai dat sua PATH trong registry, nhung
REM  cua so cmd dang mo van giu ban PATH tu luc no khoi dong. Khong doc lai
REM  tu registry thi vua cai xong van bao "khong tim thay Node.js", va nguoi
REM  dung tuong la cai hong.
REM ---------------------------------------------------------------------------
echo.
echo   [3/3] Nap lai duong dan he thong...
echo   [3/3] Nap lai PATH >> "%LOG%"

call :nap_path

call :kiem_tra
if "!NODE_OK!"=="1" (
    echo.
    echo ========================================================
    echo   DA CAI XONG NODE.JS !NODEVER!
    echo ========================================================
    echo   Da cai xong: !NODEVER! >> "%LOG%"
    del /f /q "!MSI!" >nul 2>&1
    exit /b 0
)

echo.
echo   [*] Cai xong nhung cua so nay chua thay Node.js.
echo       Hay DONG cua so nay, mo lai file vua chay - la duoc.
echo   Cai xong nhung PATH chua nhan >> "%LOG%"
pause
exit /b 1

REM ===========================================================================
:tu_cai
echo.
echo ========================================================
echo   CAI TAY - 3 BUOC
echo ========================================================
echo.
echo     1. Mo  https://nodejs.org
echo     2. Tai nut xanh ben trai ^(ban "LTS"^), cai dat,
echo        giu nguyen muc "Add to PATH"
echo     3. DONG cua so nay, mo lai file vua chay
echo.
echo   Nhat ky: CAI_NODEJS_LOG.txt
echo.
pause
exit /b 1

REM ===========================================================================
REM  :nap_path - doc lai PATH tu registry vao cua so dang chay
REM ===========================================================================
:nap_path
set "USERPATH="
set "SYSPATH="
for /f "tokens=2,*" %%A in ('reg query "HKCU\Environment" /v PATH 2^>nul ^| findstr /i "REG_"') do set "USERPATH=%%B"
for /f "tokens=2,*" %%A in ('reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /v PATH 2^>nul ^| findstr /i "REG_"') do set "SYSPATH=%%B"
if defined SYSPATH  set "PATH=!SYSPATH!"
if defined USERPATH set "PATH=!PATH!;!USERPATH!"
set "PATH=!PATH!;%ProgramFiles%\nodejs;%LOCALAPPDATA%\Programs\nodejs;%APPDATA%\npm"
exit /b 0

REM ===========================================================================
REM  :kiem_tra - dat NODE_OK=1 va NODEVER neu Node.js chay duoc va du moi
REM  ---------------------------------------------------------------------
REM  Khong dung file tam, khong dung "set /p", khong dung pipe. Chi "for /f"
REM  doc thang ket qua lenh. Khong co duong nao de no dung lai cho go phim.
REM ===========================================================================
:kiem_tra
set "NODE_OK="
set "NODEVER="
set "NPMVER="
set "MAJOR="


for /f "delims=" %%V in ('node -v 2^>nul') do if not defined NODEVER set "NODEVER=%%V"

if not defined NODEVER (
    echo   node -v khong in ra gi - coi nhu chua co Node.js >> "%LOG%"
    exit /b 0
)

REM  Phai co dang v<so>. Stub cua Microsoft Store in ra mot cau quang cao,
REM  khong phai so phien ban - bat o day.
if /i not "!NODEVER:~0,1!"=="v" (
    echo   node -v tra ve chuoi la: !NODEVER! >> "%LOG%"
    exit /b 0
)

for /f "tokens=1 delims=." %%M in ("!NODEVER:~1!") do set "MAJOR=%%M"
if not defined MAJOR (
    echo   khong doc duoc so phien ban tu: !NODEVER! >> "%LOG%"
    exit /b 0
)

REM  Ep ve so bang "set /a". Chuoi khong phai so thi set /a coi do la ten bien
REM  chua dat, va cho ra 0 - nen 0 nghia la "khong doc duoc so phien ban".
REM  (Ban truoc thu dung 'for /f "delims=0123456789"' de xem con rac khong.
REM   Cach do sai: chay thu tren cmd.exe that thi mot chuoi TOAN SO van ra
REM   token, nen Node.js v16 hop le bi gat nham voi ly do "khong hop le".)
set "MAJORNUM=0"
set /a MAJORNUM=MAJOR >nul 2>&1
if !MAJORNUM! EQU 0 (
    echo   khong doc duoc so phien ban tu: !NODEVER! >> "%LOG%"
    exit /b 0
)

REM  Ban qua cu chay khong noi Electron 33 - doi hoi Node 18 tro len.
if !MAJORNUM! LSS %MIN_MAJOR% (
    echo.
    echo   [*] Node.js !NODEVER! qua cu - can ban %MIN_MAJOR% tro len.
    echo   Node qua cu: !NODEVER! >> "%LOG%"
    exit /b 0
)

REM  Co Node ma khong co npm thi coi nhu chua cai xong.
for /f "delims=" %%V in ('npm -v 2^>nul') do if not defined NPMVER set "NPMVER=%%V"
if not defined NPMVER (
    echo   co node !NODEVER! nhung npm khong chay duoc >> "%LOG%"
    exit /b 0
)

set "NODE_OK=1"
exit /b 0
