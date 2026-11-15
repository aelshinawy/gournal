# VHS tape for the gournal README demo.
# Regenerate from the repository root after npm run build: vhs demo.tape
# The hidden setup makes a fresh mktemp home with fixture data (scripts/demo/setup.sh).
# It never reads or writes ~/.gournal.

Output demo.gif

Require node
Require git

Set Shell "bash"
Set FontFamily "JetBrainsMono Nerd Font"
Set FontSize 20
Set LineHeight 1.2
Set Width 1100
Set Height 900
Set Padding 28
Set Theme { "name": "gournal-dracula-muted", "black": "#1f2029", "red": "#f08080", "green": "#7fdc97", "yellow": "#e3e39a", "blue": "#a98be6", "magenta": "#e39bd0", "cyan": "#7fd6ea", "white": "#ecebf3", "brightBlack": "#9a9fc2", "brightRed": "#f5a0a0", "brightGreen": "#9ee8b0", "brightYellow": "#ecedb5", "brightBlue": "#b9a0f0", "brightMagenta": "#f0b4de", "brightCyan": "#a5e3f0", "brightWhite": "#ffffff", "background": "#17181f", "foreground": "#ecebf3", "selection": "#353749", "cursor": "#a98be6" }
Set TypingSpeed 45ms
Set Framerate 15
Set CursorBlink false

Hide
Type "source scripts/demo/setup.sh"
Enter
Sleep 4s
Show

Sleep 500ms
Type "gournal add 'Paired on the refresh fix review' --tags review"
Enter
Sleep 1500ms

Type "gournal standup"
Enter
Sleep 6s
