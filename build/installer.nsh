; ── MemeFlash by MemeCorp — Custom Installer ─────────────────────────────────

!define MUI_WELCOMEPAGE_TITLE "MemeFlash by MemeCorp"
!define MUI_WELCOMEPAGE_TEXT "Bienvenue dans l'installateur de MemeFlash !$\r$\n$\r$\nMemeFlash affiche en temps réel les mèmes que tes potes envoient sur Discord, directement par-dessus ton jeu.$\r$\n$\r$\nCliquez sur Suivant pour continuer."

!define MUI_FINISHPAGE_TITLE "MemeFlash est prêt !"
!define MUI_FINISHPAGE_TEXT "MemeFlash by MemeCorp a été installé avec succès.$\r$\n$\r$\nBon gaming !"

!define MUI_DIRECTORYPAGE_TEXT_TOP "Choisissez le dossier d'installation de MemeFlash."

!macro customInstall
  ; Désinstalle l'ancienne version MemeDrop (com.memecorp.memedrop)
  ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\com.memecorp.memedrop" "UninstallString"
  StrCmp $0 "" done_old_uninst
  ExecWait '"$0" /S'
  done_old_uninst:
!macroend

!macro customUnInstall
!macroend
