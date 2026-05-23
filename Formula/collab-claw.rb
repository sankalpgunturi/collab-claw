# Homebrew formula for collab-claw.
#
# This file is *staged in the repo*. To actually publish via Homebrew:
#
#   1. git tag v0.2.1 && git push --tags          (cuts the release tarball)
#   2. Compute the SHA256:
#        curl -sL https://github.com/sankalpgunturi/collab-claw/archive/refs/tags/v0.2.1.tar.gz \
#          | shasum -a 256
#   3. Replace SHA256_PLACEHOLDER below with the real digest.
#   4. Copy this file into a separate tap repo (e.g. sankalpgunturi/homebrew-tap)
#      at Formula/collab-claw.rb.
#   5. Users then:
#        brew tap sankalpgunturi/tap
#        brew install collab-claw
#
# The formula has no platform-specific bottles — collab-claw is pure Node,
# so the same source archive works on Apple Silicon, Intel macOS, and Linux.

class CollabClaw < Formula
  desc "Pair-program with one Claude across multiple laptops"
  homepage "https://github.com/sankalpgunturi/collab-claw"
  url "https://github.com/sankalpgunturi/collab-claw/archive/refs/tags/v0.2.1.tar.gz"
  sha256 "c36bd14e9989c3ff28ef0bebbadf5ead3dc7e2f17b2b89686ef81401bce53155"
  license "MIT"

  depends_on "node"

  def install
    # Install everything Node-side under libexec, then expose the CLI on PATH
    # via a shim that points at libexec/bin/collab-claw.
    libexec.install Dir["*"]
    bin.install_symlink libexec/"bin/collab-claw"
  end

  test do
    assert_match(/collab-claw v/, shell_output("#{bin}/collab-claw version"))
  end
end
