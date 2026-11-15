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
Set Theme { "name": "gournal-ink", "black": "#17140f", "red": "#f0937a", "green": "#b7c98f", "yellow": "#e9c47e", "blue": "#e8885c", "magenta": "#d9a3c0", "cyan": "#9cc7c0", "white": "#f1eadc", "brightBlack": "#a89f8a", "brightRed": "#f5a68f", "brightGreen": "#c7d6a3", "brightYellow": "#f0d394", "brightBlue": "#f2a67f", "brightMagenta": "#e6b9d1", "brightCyan": "#b4d6d0", "brightWhite": "#fffaf2", "background": "#1d1912", "foreground": "#f1eadc", "selection": "#4d4535", "cursor": "#e8885c" }
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
