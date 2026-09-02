require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

# libssh2 is vendored rather than pulled from CocoaPods on purpose: the pod
# named `libssh2` there is 1.4.3, from 2013, and the wrappers that bundle their
# own copy (NMSSH, SwiftSH) ship prebuilt binaries from 2019. None of them can
# do Ed25519, curve25519-sha256 or rsa-sha2-*, which a current OpenSSH server
# requires -- the same reason the Android engine uses mwiede's JSch fork rather
# than the original.
Pod::Spec.new do |s|
  s.name           = 'ExpoSSHBond'
  s.version        = package['version']
  s.summary        = 'Native SSH transport for SSHBond'
  s.description    = 'Real SSH over libssh2, with the host key handed to JavaScript before authentication.'
  s.license        = 'MIT'
  s.author         = package['author'] || 'SSHBond'
  s.homepage       = package['homepage'] || 'https://github.com/sshbond/sshbond'
  s.platforms      = {
    :ios => '15.1',
  }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  # OpenSSL 3 is the crypto backend libssh2 is compiled against below.
  s.dependency 'OpenSSL-Universal', '~> 3.6'

  s.source_files = '*.{h,swift}',
                   'vendor/libssh2/src/*.{c,h}',
                   'vendor/libssh2/include/*.h',
                   'vendor/libssh2/libssh2_config.h'

  # libssh2 is partly an amalgamation: crypto.c #includes the backend it was
  # configured with, bcrypt_pbkdf.c #includes blowfish.c, and agent.c #includes
  # agent_win.c, which guards itself out on anything but Windows. Upstream's
  # src/Makefile.inc lists 26 translation units and leaves these three out;
  # compiling them a second time on their own would duplicate every symbol they
  # define. They stay on disk because the #include directives need them.
  s.exclude_files = 'vendor/libssh2/src/agent_win.c',
                    'vendor/libssh2/src/blowfish.c',
                    'vendor/libssh2/src/openssl.c'

  # Every vendored header is private. CocoaPods treats unlisted headers as
  # public and folds them into this pod's umbrella module, which would then
  # claim the same declarations as the hand-written Libssh2 module map -- and a
  # header compiled into two clang modules is a redefinition of everything it
  # declares. Swift reaches libssh2 through the module map alone.
  s.private_header_files = 'vendor/libssh2/include/*.h',
                           'vendor/libssh2/src/*.h',
                           'vendor/libssh2/libssh2_config.h'
  s.preserve_paths      = 'vendor/libssh2/swiftmodule/module.modulemap',
                          'vendor/libssh2/src/agent_win.c',
                          'vendor/libssh2/src/blowfish.c',
                          'vendor/libssh2/src/openssl.c'

  # HAVE_CONFIG_H makes libssh2_setup.h read the hand-written
  # vendor/libssh2/libssh2_config.h; LIBSSH2_OPENSSL selects the backend.
  s.compiler_flags = '-DHAVE_CONFIG_H', '-DLIBSSH2_OPENSSL', '-Wno-shorten-64-to-32'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule',
    'HEADER_SEARCH_PATHS' => [
      '"${PODS_TARGET_SRCROOT}/vendor/libssh2"',
      '"${PODS_TARGET_SRCROOT}/vendor/libssh2/include"',
      '"${PODS_TARGET_SRCROOT}/vendor/libssh2/src"',
    ].join(' '),
    # Where `import Libssh2` finds its module map. Deliberately a directory
    # that is not on HEADER_SEARCH_PATHS: clang picks up module maps from there
    # too, and would modularise the headers for the C sources as well.
    'SWIFT_INCLUDE_PATHS' => '"${PODS_TARGET_SRCROOT}/vendor/libssh2/swiftmodule"',
  }
end
