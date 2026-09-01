/*
 * Build configuration for libssh2 on Apple platforms.
 *
 * Upstream generates this with autotools or CMake. Neither runs inside a
 * CocoaPods build, so it is written out by hand: every macro below is a fact
 * about Darwin, and the set is taken from src/libssh2_config_cmake.h.in.
 *
 * The crypto backend is selected in the podspec with -DLIBSSH2_OPENSSL, so
 * that OpenSSL 3 supplies Ed25519, curve25519-sha256 and rsa-sha2-*, none of
 * which the abandoned prebuilt libssh2 binaries on CocoaPods carry.
 */

#ifndef LIBSSH2_CONFIG_H
#define LIBSSH2_CONFIG_H

/* Headers */
#define HAVE_UNISTD_H
#define HAVE_INTTYPES_H
#define HAVE_SYS_SELECT_H
#define HAVE_SYS_UIO_H
#define HAVE_SYS_SOCKET_H
#define HAVE_SYS_IOCTL_H
#define HAVE_SYS_TIME_H
#define HAVE_SYS_UN_H
#define HAVE_ARPA_INET_H
#define HAVE_NETINET_IN_H

/* Functions */
#define HAVE_GETTIMEOFDAY
#define HAVE_STRTOLL
#define HAVE_SNPRINTF
#define HAVE_MEMSET_S

#define HAVE_POLL
#define HAVE_SELECT

/* Socket non-blocking support */
#define HAVE_O_NONBLOCK
#define HAVE_FIONBIO

#endif /* LIBSSH2_CONFIG_H */
