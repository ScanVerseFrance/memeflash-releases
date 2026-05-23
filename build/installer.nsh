; ── MemeFlash by MemeCorp — Custom Installer ─────────────────────────────────

; Texte neutre (affiche aussi bien à l'install qu'à la désinstall)
!define MUI_WELCOMEPAGE_TITLE "MemeFlash by MemeCorp"
!define MUI_WELCOMEPAGE_TEXT "Bienvenue !$\r$\n$\r$\nMemeFlash affiche en temps réel les mèmes que tes potes envoient sur Discord, directement par-dessus ton jeu.$\r$\n$\r$\nCliquez sur Suivant pour continuer."

!define MUI_FINISHPAGE_TITLE "MemeFlash est prêt !"
!define MUI_FINISHPAGE_TEXT "L'opération s'est terminée avec succès.$\r$\n$\r$\nBon gaming !"

!define MUI_DIRECTORYPAGE_TEXT_TOP "Choisissez le dossier d'installation de MemeFlash."

!macro customInstall
  ; ── Supprime l'ancienne installation MemeDrop (com.memecorp.memedrop) ──────
  ; Vérifie d'abord HKCU (per-user), puis HKLM (per-machine)
  ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\com.memecorp.memedrop" "UninstallString"
  StrCmp $0 "" check_hklm run_uninst
  check_hklm:
  ReadRegStr $0 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\com.memecorp.memedrop" "UninstallString"
  StrCmp $0 "" check_wow64 run_uninst
  check_wow64:
  ReadRegStr $0 HKLM "Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\com.memecorp.memedrop" "UninstallString"
  StrCmp $0 "" done_old_uninst run_uninst
  run_uninst:
  ExecWait '$0 /S'
  done_old_uninst:
!macroend

!macro customUnInstall
!macroend
