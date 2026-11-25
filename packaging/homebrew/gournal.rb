class Gournal < Formula
  desc "Local-first work journal for you and your AI agents"
  homepage "https://gournal.aelshinawy.com/"
  url "https://registry.npmjs.org/gournal/-/gournal-0.0.0.tgz"
  sha256 "0000000000000000000000000000000000000000000000000000000000000000"
  license "MIT"

  include Language::Node::Shebang

  depends_on "node"

  def install
    system "npm", "install", *std_npm_args
    bin.install_symlink libexec.glob("bin/*")
    rewrite_shebang detected_node_shebang, libexec/"lib/node_modules/gournal/dist/cli.js"
  end

  def caveats
    <<~EOS
      To connect Claude Code, run:
        gournal setup claude
      Before you uninstall gournal, run:
        gournal setup claude --uninstall
      If you forget, run this later:
        ~/.gournal/bin/gournal setup claude --uninstall
    EOS
  end

  test do
    ENV["GOURNAL_HOME"] = (testpath/".gournal").to_s
    ENV["GOURNAL_NO_AUTOSYNC"] = "1"
    assert_equal version.to_s, shell_output("#{bin}/gournal --version").strip
    system bin/"gournal", "add", "brew test"
    assert_match "brew test", shell_output("#{bin}/gournal find brew")
  end
end
