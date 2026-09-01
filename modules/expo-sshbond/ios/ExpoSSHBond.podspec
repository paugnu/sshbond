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

  # Only libssh2.h and friends are API; everything under src/ is internal and
  # would collide with other pods if it were public.
  s.public_header_files = 'vendor/libssh2/include/*.h'
  s.preserve_paths      = 'vendor/libssh2/module.modulemap'

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
    # Where `import Libssh2` finds its module map.
    'SWIFT_INCLUDE_PATHS' => '"${PODS_TARGET_SRCROOT}/vendor/libssh2"',
  }
end
