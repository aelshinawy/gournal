# VHS tape for the homepage demo. Run from the repository root after npm run build:
#   vhs scripts/demo/standup.tape
# It records against a fresh mktemp home with fixture data. It never reads ~/.gournal.

Output site/public/demo/standup.webm
Output site/public/demo/standup.mp4

Require node
Require git

Set Shell "bash"
Set FontFamily "JetBrainsMono Nerd Font"
Set FontSize 24
Set LineHeight 1.2
Set Width 920
Set Height 1000
Set Padding 32
Set Margin 0
Set BorderRadius 0
Set Theme { "name": "gournal-ink", "black": "#17140f", "red": "#f0937a", "green": "#b7c98f", "yellow": "#e9c47e", "blue": "#e8885c", "magenta": "#d9a3c0", "cyan": "#9cc7c0", "white": "#f1eadc", "brightBlack": "#a89f8a", "brightRed": "#f5a68f", "brightGreen": "#c7d6a3", "brightYellow": "#f0d394", "brightBlue": "#f2a67f", "brightMagenta": "#e6b9d1", "brightCyan": "#b4d6d0", "brightWhite": "#fffaf2", "background": "#1d1912", "foreground": "#f1eadc", "selection": "#4d4535", "cursor": "#e8885c" }
Set TypingSpeed 70ms
Set Framerate 24
Set CursorBlink false

Hide
Type "source scripts/demo/setup.sh"
Enter
Sleep 4s
Show

Sleep 600ms
Type "gournal standup"
Sleep 400ms
Enter
Sleep 1500ms
Screenshot site/public/demo/standup-poster.png
Sleep 6s
