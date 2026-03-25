; Celeste POS - Custom NSIS Installer Script
; Adds auto-start option and custom registry entries

!macro customInstall
  ; Add to Windows startup (optional - user can toggle)
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "CelestePos" "$INSTDIR\Celeste POS.exe --startup"

  ; Register URL protocol handler (celestepos://)
  WriteRegStr HKCR "celestepos" "" "URL:Celeste POS Protocol"
  WriteRegStr HKCR "celestepos" "URL Protocol" ""
  WriteRegStr HKCR "celestepos\shell\open\command" "" '"$INSTDIR\Celeste POS.exe" "%1"'

  ; Create data directory
  CreateDirectory "$APPDATA\CelestePos"
!macroend

!macro customUnInstall
  ; Remove from startup
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "CelestePos"

  ; Remove URL protocol handler
  DeleteRegKey HKCR "celestepos"
!macroend
