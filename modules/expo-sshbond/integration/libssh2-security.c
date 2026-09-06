/* Runs the vendored C parser against malformed pre-auth extension packets. */
#include "libssh2_priv.h"
#include "packet.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int main(void)
{
    unsigned char cases[][13] = {
        {7, 255, 255, 255, 255}, /* huge count with no strings */
        {7, 0, 0, 0, 1, 0, 0, 0, 1, 'a'}, /* missing value */
        {7, 0, 0, 0, 1, 255, 255, 255, 255}, /* oversized name */
    };
    size_t lengths[] = {5, 10, 9};
    unsigned int i;
    if(libssh2_init(0)) return 1;
    for(i = 0; i < 3; i++) {
        LIBSSH2_SESSION *session = libssh2_session_init();
        unsigned char *packet = malloc(lengths[i]);
        if(!session || !packet) return 2;
        memcpy(packet, cases[i], lengths[i]);
        /* _libssh2_packet_add owns/frees this packet. The process timeout
         * catches the pre-patch CPU loop for the first case. */
        _libssh2_packet_add(session, packet, lengths[i], 0, 0);
        libssh2_session_free(session);
    }
    libssh2_exit();
    puts("PASS: malformed EXT_INFO packets terminate without crashing");
    return 0;
}
