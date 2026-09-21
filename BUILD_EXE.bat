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
title Flow Automation Studio - Build EXE

REM ===========================================================================
REM  BUILD_EXE.bat - dong goi thanh file .exe chay thang, khong can Node.js nua
REM  ---------------------------------------------------------------------
REM  Chay MOT LAN tren may Windows cua ban. Xong se co hai file trong thu muc
REM  "dist":
REM
REM    FlowAutomationStudio-<phien ban>-setup.exe     <- ban CAI DAT
REM        Cai vao may, tao loi tat ngoai Desktop va trong Start Menu. Mo
REM        nhanh. Nen dung cai nay.
REM
REM    FlowAutomationStudio-<phien ban>-portable.exe  <- MOT FILE DUY NHAT
REM        Khong can cai. Chep di dau cung chay duoc, ke ca USB. Doi lai moi
REM        lan mo phai tu giai nen ra thu muc tam nen cham hon vai giay.
REM
REM  Ca hai deu KHONG can Node.js de chay - Node.js chi can cho luc build.
REM  Du lieu (tai khoan, cai dat, du an) nam o %APPDATA%\Flow Automation Studio
REM  nen ban .exe va ban chay tu nguon dung chung du lieu.
REM
REM  Moi thu duoc ghi vao BUILD_LOG.txt. Loi gi thi gui file do di.
REM ===========================================================================

set "HERE=%~dp0"
cd /d "%HERE%"
set "LOG=%HERE%BUILD_LOG.txt"

REM  Khong di tim chung chi ky so - chung ta khong co, va app khong can.
set "CSC_IDENTITY_AUTO_DISCOVERY=false"

echo ======================================================== > "%LOG%"
echo  Flow Automation Studio - build log                     >> "%LOG%"
echo  Bat dau: %DATE% %TIME%                                 >> "%LOG%"
echo ======================================================== >> "%LOG%"

echo.
echo ========================================================
echo   FLOW AUTOMATION STUDIO - DONG GOI THANH FILE .EXE
echo ========================================================
echo.
echo   Mat khoang 5-15 phut cho lan dau. Nhat ky: BUILD_LOG.txt
echo.

REM ---------------------------------------------------------------------------
REM  BUOC 1: Node.js
REM ---------------------------------------------------------------------------
echo [1/6] Kiem tra Node.js...
echo [1/6] Node.js >> "%LOG%"

call "%HERE%CAI_NODEJS.bat"
if !ERRORLEVEL! NEQ 0 exit /b 1

REM Nap lai PATH: cua so cua CAI_NODEJS.bat la moi truong rieng, PATH no sua
REM khong theo sang day duoc.
call :nap_path

REM  KHONG dung "set /p NODEVER=<file" nhu ban 2.5.0: file rong thi "set /p"
REM  quay ra cho nguoi dung go phim, man hinh dung im o dung buoc [1/6] nay.
set "NODEVER="
for /f "delims=" %%V in ('node -v 2^>nul') do if not defined NODEVER set "NODEVER=%%V"

if not defined NODEVER (
    echo.
    echo   [*] Node.js vua duoc cai nhung cua so nay chua nhan.
    echo       Hay DONG cua so nay va mo lai file BUILD_EXE.bat.
    echo.
    pause
    exit /b 1
)
echo    OK: Node.js !NODEVER!
echo    Node !NODEVER! >> "%LOG%"

REM ---------------------------------------------------------------------------
REM  BUOC 2: Kiem tra node_modules co hong khong
REM  Mot lan chay truoc that bai giua chung co the de lai thu muc hong.
REM ---------------------------------------------------------------------------
echo.
echo [2/6] Kiem tra thu vien da cai...
echo [2/6] Kiem tra node_modules >> "%LOG%"

if exist "node_modules\electron\package.json" (
    REM  PHAI co "call": ai dung nvm-windows / Volta / fnm thi "node" tren may
    REM  ho la node.cmd chu khong phai node.exe. Goi mot file .cmd/.bat tu trong
    REM  file .bat MA KHONG CO "call" thi dieu khien di luon, KHONG quay lai -
    REM  script nay chet giua chung va cua so dong ngay, y het trieu chung
    REM  "tu bien mat". Tren may co node.exe that thi "call" khong hai gi.
    call node -e "require('./node_modules/electron/package.json')" >nul 2>&1
    if !ERRORLEVEL! NEQ 0 (
        echo    node_modules hong - dang xoa de cai lai
        echo    node_modules hong, xoa di >> "%LOG%"
        rmdir /s /q node_modules 2>nul
    ) else (
        echo    OK: thu vien da san sang
        echo    node_modules OK >> "%LOG%"
    )
)

REM ---------------------------------------------------------------------------
REM  BUOC 3: Cai thu vien
REM ---------------------------------------------------------------------------
echo.
echo [3/6] Cai thu vien ^(lan dau mat 3-10 phut, tai khoang 250 MB^)...
echo [3/6] npm install >> "%LOG%"

if not exist "node_modules\electron\package.json" (
    call npm install --no-audit --no-fund >>"%LOG%" 2>&1
    if !ERRORLEVEL! NEQ 0 goto :loi_mang
)
echo    OK

REM ===========================================================================
REM  BUOC 4: DON DUONG CHO BO CONG CU KY SO  <-- BUOC MOI, SUA LOI THAT
REM  ---------------------------------------------------------------------
REM  LOI GAP THAT (bao cao kem BUILD_LOG.txt, ban 2.6.0):
REM
REM     ERROR: Cannot create symbolic link :
REM            A required privilege is not held by the client. :
REM            ...\winCodeSign\...\darwin\10.12\lib\libcrypto.dylib
REM
REM  Chuyen gi xay ra: electron-builder tai goi "winCodeSign-2.6.0.7z" roi
REM  giai nen. Ben trong goi do co thu muc "darwin" - phan danh cho macOS - va
REM  trong do co HAI SYMLINK (libcrypto.dylib, libssl.dylib).
REM
REM  Windows KHONG cho tai khoan thuong tao symlink. Muon tao phai la
REM  Administrator, hoac phai bat Developer Mode. Nguoi dung binh thuong bam
REM  doi vao file .bat thi khong co quyen do, nen 7za bao loi, electron-builder
REM  thu lai 4 lan roi bo cuoc. Build that bai vi hai file cua macOS ma ban
REM  build Windows KHONG BAO GIO dung toi. Vo ly, nhung that.
REM
REM  CACH SUA O DAY: tu giai nen goi do TRUOC, va BO QUA thu muc darwin
REM  (tham so -xr!darwin). electron-builder thay thu muc cache da co san thi
REM  khong tai, khong giai nen nua - nen khong bao gio cham toi symlink.
REM  Khong can quyen Administrator, khong can bat Developer Mode.
REM
REM  Da kiem chung: xoa han thu muc darwin roi chay build Windows day du,
REM  ra du ca hai file .exe, khong thieu gi.
REM ===========================================================================
echo.
echo [4/6] Don duong cho bo cong cu dong goi...
echo [4/6] winCodeSign >> "%LOG%"

REM  --- VIET PHANG BANG NHAN, KHONG DUNG KHOI ( ) ---------------------------
REM  Ban 2.6.1 viet buoc nay bang if/else co ngoac, va cua so TU BIEN MAT ngay
REM  tai day, nhat ky dung o dong "[4/6] winCodeSign". Hai ly do, ca hai deu la
REM  cach cmd.exe DOC file chu khong phai cach no chay:
REM
REM    1. Trong khoi ( ), mot dau ) chua thoat o lenh echo se DONG KHOI SOM.
REM       Dong  "echo Dang tai bo cong cu (khoang 5,6 MB)..."  nam trong khoi
REM       else, nen dau ) sau chu MB dong khoi giua chung, phan con lai thanh
REM       cu phap rac, va cmd.exe bo chay ca file. Cua so dong ngay, khong kip
REM       in mot chu nao - dung nhu nguoi dung thay.
REM
REM    2. Noi dong bang dau ^ o cuoi dong, BEN TRONG khoi ( ), cung khong dang
REM       tin - cmd.exe doc khoi theo kieu khac han khi o ngoai.
REM
REM  Ca hai bien mat neu khong dung khoi. Duoi day chi co nhan va goto, moi
REM  lenh mot dong, lenh powershell viet lien mot dong khong noi tiep.
REM  Bai kiem thu trong tests/run.js nay soi ca hai loi tren.
REM -------------------------------------------------------------------------

set "CSVER=winCodeSign-2.6.0"
set "CSROOT=%LOCALAPPDATA%\electron-builder\Cache\winCodeSign"
if defined ELECTRON_BUILDER_CACHE set "CSROOT=%ELECTRON_BUILDER_CACHE%\winCodeSign"
set "CSDIR=%CSROOT%\%CSVER%"
set "ZA=%HERE%node_modules\7zip-bin\win\x64\7za.exe"

REM  signtool.exe la thu electron-builder that su can trong goi do. Co no thi
REM  cache dung duoc; khong thi coi nhu chua co.
if exist "%CSDIR%\windows-10\x64\signtool.exe" goto :cs_co_san
if not exist "%ZA%" goto :cs_thieu_7za

REM  --- Dung lai file da tai san, neu co ------------------------------------
REM  Nhung lan build hong truoc de lai chinh goi .7z nay trong thu muc cache,
REM  ten bang so ngau nhien (vi du 528039443.7z). electron-builder tai xong roi
REM  moi nga o buoc giai nen, nen file van nguyen va van dung. Tai lai 5,6 MB
REM  nua la phi - va neu may dang khong co mang thi day la duong duy nhat.
set "CS7Z="
for /f "delims=" %%F in ('dir /b /o-s "%CSROOT%\*.7z" 2^>nul') do if not defined CS7Z set "CS7Z=%CSROOT%\%%F"
if defined CS7Z goto :cs_da_co_goi

echo    Dang tai bo cong cu, khoang 5,6 MB...
set "CS7Z=%TEMP%\winCodeSign-2.6.0.7z"
if exist "%CS7Z%" del /f /q "%CS7Z%" >nul 2>&1
set "CSURL=https://github.com/electron-userland/electron-builder-binaries/releases/download/winCodeSign-2.6.0/winCodeSign-2.6.0.7z"

powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -UseBasicParsing -Uri '%CSURL%' -OutFile '%CS7Z%'" >>"%LOG%" 2>&1
if exist "%CS7Z%" goto :cs_don_rac

REM  PowerShell hong thi thu curl.exe - Windows 10 ban 1803 tro len va
REM  Windows 11 deu co san, khong phai cai gi. Mot duong nua cho re, va co
REM  may cau hinh chinh sach chan PowerShell nhung khong chan curl.
echo    PowerShell khong tai duoc, dang thu curl...
echo    PowerShell that bai, thu curl >> "%LOG%"
curl.exe -L --fail --silent --show-error -o "%CS7Z%" "%CSURL%" >>"%LOG%" 2>&1
if not exist "%CS7Z%" goto :cs_tai_hong
goto :cs_don_rac

:cs_da_co_goi
echo    Dung lai goi da tai san tu lan truoc.
echo    Dung lai %CS7Z% >> "%LOG%"

:cs_don_rac
REM  Don rac cua nhung lan chay truoc: giai nen that bai giua chung de lai cac
REM  thu muc danh so ngau nhien. Don SAU khi da chon xong file .7z o tren,
REM  khong thi xoa mat thu minh vua dinh dung.
REM  Dung "dir /b /ad" chu khong dung "for /d %%D in (...\*)": cach sau chay
REM  qua ma khong xoa cai nao khi duong dan nam trong dau nhay - da thu.
for /f "delims=" %%D in ('dir /b /ad "%CSROOT%" 2^>nul') do if /i not "%%D"=="%CSVER%" rmdir /s /q "%CSROOT%\%%D" 2>nul
if exist "%CSDIR%" rmdir /s /q "%CSDIR%" 2>nul
mkdir "%CSDIR%" 2>nul

echo    Dang giai nen, bo qua phan danh cho macOS...

REM  PHAI tat delayed expansion cho dung dong goi 7za. Tham so bo thu muc la
REM  -xr!darwin - co dau "!". Khi EnableDelayedExpansion dang bat thi cmd.exe
REM  an mat dau "!", tham so bien thanh "-xrdarwin": sai, 7za bo chay, KHONG
REM  giai nen gi ca, ma buoc sau van di tiep nhu khong co chuyen gi.
setlocal DisableDelayedExpansion
"%ZA%" x "%CS7Z%" -o"%CSDIR%" -xr!darwin -y >>"%LOG%" 2>&1
endlocal

if not exist "%CSDIR%\windows-10\x64\signtool.exe" goto :cs_dung_hong

echo    OK
echo    winCodeSign da dung san, khong co thu muc darwin >> "%LOG%"
REM  Xong roi moi don: cac .7z danh so ngau nhien tu nhung lan hong truoc
REM  chiem moi cai 5,6 MB va khong con viec gi nua.
del /f /q "%CSROOT%\*.7z" 2>nul
del /f /q "%TEMP%\winCodeSign-2.6.0.7z" 2>nul
goto :cs_xong

:cs_dung_hong
REM  KHONG xoa file .7z o nhanh nay: lan chay sau con dung lai duoc, va neu
REM  may khong co mang thi do la duong duy nhat.
echo    Chua dung duoc - de electron-builder tu lo buoc nay.
echo    Dung san winCodeSign that bai >> "%LOG%"
rmdir /s /q "%CSDIR%" 2>nul
goto :cs_xong

:cs_co_san
echo    OK: da co san, bo qua
echo    winCodeSign da co san >> "%LOG%"
goto :cs_xong

:cs_thieu_7za
echo    Khong thay 7za.exe - de electron-builder tu lo buoc nay.
echo    Khong thay 7za.exe >> "%LOG%"
goto :cs_xong

:cs_tai_hong
echo    Tai khong duoc - de electron-builder tu lo buoc nay.
echo    Tai winCodeSign that bai >> "%LOG%"
goto :cs_xong

:cs_xong

REM ---------------------------------------------------------------------------
REM  BUOC 5: Dong goi
REM  ---------------------------------------------------------------------
REM  Lan dau, electron-builder con phai tai them Electron va bo cong cu NSIS -
REM  khoang 120 MB nua. Tai ve mot lan roi nam trong cache, lan sau khong tai
REM  lai. (Hai goi NSIS khong co symlink nen khong dinh loi o buoc 4.)
REM ---------------------------------------------------------------------------
echo.
echo [5/6] Dang dong goi ^(mat 3-10 phut^)...
echo    - Lan dau con tai them Electron, khoang 120 MB.
echo [5/6] electron-builder >> "%LOG%"

if exist "dist" rmdir /s /q dist 2>nul

call npx electron-builder --win --x64 >>"%LOG%" 2>&1
set "RCBUILD=!ERRORLEVEL!"

REM ---------------------------------------------------------------------------
REM  BUOC 6: Xac nhan file that su ton tai
REM  Phan mem diet virus doi khi XOA file .exe vua build xong ma khong bao gi.
REM  Build "thanh cong" ma khong co file la chuyen co that.
REM ---------------------------------------------------------------------------
echo.
echo [6/6] Kiem tra ket qua...

set "SETUP="
set "PORTABLE="
for %%F in ("dist\*setup.exe")    do set "SETUP=%%~fF"
for %%F in ("dist\*portable.exe") do set "PORTABLE=%%~fF"

if not defined SETUP if not defined PORTABLE goto :khong_co_exe

echo.
echo ========================================================
echo   DA XONG
echo ========================================================
echo.
if defined SETUP    echo   Ban cai dat  : !SETUP!
if defined PORTABLE echo   Ban mot file : !PORTABLE!
echo.
echo   LUU Y khi mo lan dau:
echo   Windows SmartScreen se bao "Unknown publisher" vi file .exe nay
echo   khong mua chu ky so ^(vai tram USD mot nam^). Day la binh thuong voi
echo   moi app tu build. Bam "More info" roi "Run anyway" de mo.
echo.
echo   Build thanh cong >> "%LOG%"
echo   setup=!SETUP! portable=!PORTABLE! >> "%LOG%"

choice /c CK /n /m "  Mo thu muc dist bay gio? (C/K): "
if !ERRORLEVEL! EQU 1 start "" "%HERE%dist"
exit /b 0

REM ===========================================================================
:khong_co_exe
REM  Khong ra file .exe nao. Truoc khi bo cuoc, thu duong lui: ban dang thu muc.
REM  Duong nay bo qua han buoc dong goi NSIS - cung la buoc hay hong nhat - va
REM  van cho ra mot app CHAY DUOC that su, chi la dang thu muc thay vi mot file.
echo.
echo   Chua ra file .exe don le. Dang thu cach khac: dung ban THU MUC...
echo   Thu --dir >> "%LOG%"

call npx electron-builder --win --x64 --dir >>"%LOG%" 2>&1

if exist "dist\win-unpacked\Flow Automation Studio.exe" (
    echo.
    echo ========================================================
    echo   XONG - NHUNG O DANG THU MUC
    echo ========================================================
    echo.
    echo   App chay duoc day du, bam vao file nay de mo:
    echo.
    echo      %HERE%dist\win-unpacked\Flow Automation Studio.exe
    echo.
    echo   Khac biet duy nhat so voi ban .exe don le: phai giu nguyen ca thu
    echo   muc "win-unpacked", khong tach rieng file .exe ra duoc. Ban co the
    echo   tao loi tat cua file do ra Desktop cho tien.
    echo.
    echo   Vi sao chi ra duoc dang nay: buoc dong goi thanh MOT file can bo
    echo   cong cu NSIS, va buoc do vua that bai. Xem BUILD_LOG.txt.
    echo.
    echo   Ban thu muc OK >> "%LOG%"
    choice /c CK /n /m "  Mo thu muc do bay gio? (C/K): "
    if !ERRORLEVEL! EQU 1 start "" "%HERE%dist\win-unpacked"
    exit /b 0
)

echo.
echo ========================================================
echo   BUILD THAT BAI
echo ========================================================
echo.
echo   25 dong cuoi cua nhat ky:
echo.
powershell -NoProfile -Command "Get-Content -Tail 25 '%LOG%'" 2>nul
echo.

REM  Doc nhat ky de goi ten dung benh, thay vi bat nguoi dung tu doan.
findstr /i /c:"Cannot create symbolic link" "%LOG%" >nul 2>&1
if !ERRORLEVEL! EQU 0 (
    echo   ----------------------------------------------------
    echo   Nhat ky co dong "Cannot create symbolic link".
    echo   Nghia la Windows khong cho tai khoan cua ban tao symlink.
    echo   Buoc [4/6] dang le da tranh duoc chuyen nay. Neu van gap,
    echo   thu MOT trong hai cach:
    echo.
    echo     1. Bam chuot phai vao BUILD_EXE.bat, chon
    echo        "Run as administrator", roi chay lai.
    echo.
    echo     2. Bat Developer Mode: Settings -^> Privacy ^& security
    echo        -^> For developers -^> bat "Developer Mode".
    echo   ----------------------------------------------------
    echo.
)

echo   App VAN CHAY DUOC bang CHAY_TU_NGUON.bat - buoc build chi de co
echo   them file .exe cho tien, khong bat buoc.
echo.
echo   Hay gui file BUILD_LOG.txt de xem loi o dau.
echo.
pause
exit /b 1

REM ===========================================================================
:loi_mang
echo.
echo ========================================================
echo   TAI THU VIEN THAT BAI
echo ========================================================
echo.
echo   Buoc nay can tai khoang 250 MB tu mang. Hay thu:
echo     - Tat VPN / proxy roi chay lai
echo     - Doi sang mang khac ^(4G dien thoai chang han^)
echo     - Tat tam phan mem diet virus
echo.
echo   25 dong cuoi cua nhat ky:
echo.
powershell -NoProfile -Command "Get-Content -Tail 25 '%LOG%'" 2>nul
echo.
echo   Neu van khong duoc, ban van dung app binh thuong bang
echo   CHAY_TU_NGUON.bat - chi la khong co file .exe rieng.
echo.
pause
exit /b 1

REM ===========================================================================
:nap_path
set "USERPATH="
for /f "tokens=2,*" %%A in ('reg query "HKCU\Environment" /v PATH 2^>nul ^| findstr /i "REG_"') do set "USERPATH=%%B"
if defined USERPATH set "PATH=!PATH!;!USERPATH!"
set "PATH=!PATH!;%ProgramFiles%\nodejs;%LOCALAPPDATA%\Programs\nodejs;%APPDATA%\npm"
exit /b 0
