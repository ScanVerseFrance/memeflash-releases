# MemeFlash

Affiche en temps réel les mèmes que tes potes envoient sur Discord, directement par-dessus ton jeu.

## Téléchargement

**[→ Télécharger la dernière version](https://github.com/ScanVerseFrance/memeflash-releases/releases/latest)**

---

## Fonctionnalités

- Overlay transparent always-on-top (fonctionne par-dessus les jeux en borderless windowed)
- File d'attente : plusieurs mèmes s'affichent les uns après les autres
- Ciblage par ping — seul l'utilisateur pingué voit le mème
- `@everyone` pour tout le monde en même temps
- Position personnalisable (6 zones) ou aléatoire
- Son d'annonce optionnel
- Mise à jour automatique depuis GitHub
- Lance au démarrage de Windows, se minimise dans le tray

**Formats supportés :**

| Type | Détails |
|------|---------|
| Image | JPG, PNG, WEBP |
| GIF | Animé, Tenor, Giphy |
| Vidéo | MP4, WebM — 30 s max, son automatique |
| TikTok | Lien tiktok.com — vidéo extraite automatiquement |
| Twitter / X | Lien de tweet avec image ou vidéo |
| Texte seul | Message sans média |

---

## Installation

1. Télécharge `MemeFlash Setup x.x.x.exe` depuis les [releases](https://github.com/ScanVerseFrance/memeflash-releases/releases/latest)
2. Lance l'installateur et suis les étapes
3. MemeFlash se lance automatiquement

---

## Configuration

### 1. Créer un bot Discord

1. Ouvre [discord.com/developers/applications](https://discord.com/developers/applications)
2. Clique **New Application** → donne un nom → onglet **Bot**
3. Clique **Reset Token** → copie le token
4. Active les intents suivants **(obligatoires)** :
   - ✅ **Message Content Intent**
   - ✅ **Server Members Intent**
   - ✅ **Presence Intent**

### 2. Inviter le bot sur ton serveur

1. Onglet **OAuth2 → URL Generator**
2. Coche **bot** dans Scopes
3. Permissions : **Read Messages/View Channels** + **Read Message History**
4. Copie le lien généré, ouvre-le et ajoute le bot à ton serveur

### 3. Trouver l'ID du salon

1. Dans Discord : **Paramètres → Avancé → Mode développeur** ✓
2. Clic droit sur le salon → **Copier l'identifiant**

### 4. Connecter MemeFlash

1. Lance MemeFlash → onglet **Compte**
2. Colle le **Token** et le **Channel ID**
3. Clique **Connecter** — le point vert confirme la connexion

---

## Utilisation

Dans le salon Discord configuré, **pingue un utilisateur** et envoie un média :

```
@Pseudo https://www.tiktok.com/...
@Pseudo [image jointe]
@everyone [GIF]
```

Le média apparaît en overlay sur l'écran de l'utilisateur pingué.

---

## Tray & démarrage automatique

- **Croix** = minimise dans le tray (l'app continue de tourner)
- **Clic sur l'icône tray** = rouvre la fenêtre
- **Clic droit → Quitter** = ferme complètement
- MemeFlash se lance automatiquement avec Windows

---

## Mise à jour

Les mises à jour sont détectées et téléchargées automatiquement au démarrage. Une bannière verte apparaît avec un bouton **Installer et relancer**.

---

## Licence

MIT — [ScanVerseFrance](https://github.com/ScanVerseFrance)
