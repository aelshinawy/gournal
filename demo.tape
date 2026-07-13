# VHS tape for the gournal README demo.
# Regenerate with: vhs demo.tape

Output demo.gif

Require node

Set Shell "bash"
Set FontSize 22
Set Width 1200
Set Height 650
Set Theme "Dracula"
Set TypingSpeed 40ms
Set Padding 20

# Use an isolated HOME so the recording doesn't touch real gournal data,
# and alias `gournal` to the built CLI so this works before npm install.
Hide
Type "export HOME=/tmp/gournal-demo-home && rm -rf $HOME && mkdir -p $HOME && alias gournal='node dist/cli.js' && clear"
Enter
Sleep 500ms
Show

Type "gournal add 'Fixed the flaky auth test' --tags bug,testing"
Enter
Sleep 1s

Type "gournal add 'Reviewed PR for export feature' --tags review"
Enter
Sleep 1s

Type "gournal standup"
Enter
Sleep 2s

Type "gournal export --format md"
Enter
Sleep 3s
