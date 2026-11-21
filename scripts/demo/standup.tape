# VHS tape for the homepage demo and the README gif. Run from the repository root after npm run build:
#   vhs scripts/demo/standup.tape
# It records against a fresh mktemp home with fixture data. It never reads ~/.gournal.

Output site/public/demo/standup.mp4
Output demo.gif

Require node
Require git

Set Shell "bash"
Set FontFamily "JetBrainsMono Nerd Font"
Set FontSize 28
Set LineHeight 1.0
Set Width 1080
Set Height 900
Set Padding 24
Set Margin 0
Set BorderRadius 0
Set Theme { "name": "gournal-dracula-muted", "black": "#1f2029", "red": "#f08080", "green": "#7fdc97", "yellow": "#e3e39a", "blue": "#a98be6", "magenta": "#e39bd0", "cyan": "#7fd6ea", "white": "#ecebf3", "brightBlack": "#9a9fc2", "brightRed": "#f5a0a0", "brightGreen": "#9ee8b0", "brightYellow": "#ecedb5", "brightBlue": "#b9a0f0", "brightMagenta": "#f0b4de", "brightCyan": "#a5e3f0", "brightWhite": "#ffffff", "background": "#17181f", "foreground": "#ecebf3", "selection": "#353749", "cursor": "#a98be6" }
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
