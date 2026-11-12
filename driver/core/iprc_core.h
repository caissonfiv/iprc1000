#ifndef IPRC_CORE_H
#define IPRC_CORE_H
#include "../shared/iprc_protocol.h"

typedef struct IPRC_PRESS {
    uint64_t LastDownMs;
    IPRC_RULE Route;
    uint32_t Held;
} IPRC_PRESS;

typedef struct IPRC_ENGINE {
    IPRC_POLICY Policy;
    IPRC_PRESS Presses[IPRC_RULE_COUNT * 4u];
    IPRC_PACKET Queue[IPRC_QUEUE_CAPACITY];
    uint32_t Head, Count;
    uint64_t Accepted, Delivered, Suppressed, Repeats, Backpressure;
} IPRC_ENGINE;

void IpDefaults(IPRC_POLICY *policy, uint32_t mode);
int IpValidatePolicy(const IPRC_POLICY *policy);
void IpInitialize(IPRC_ENGINE *engine);
// Caller serializes all access. No allocation, wait, OS call or pageable data.
int IpAccept(IPRC_ENGINE *engine, const IPRC_PACKET *packet, uint64_t nowMs);
const IPRC_PACKET *IpPeek(const IPRC_ENGINE *engine, uint32_t *count);
void IpConsume(IPRC_ENGINE *engine, uint32_t count);
int IpIsRemoteId(const uint16_t *id, size_t length);
#endif
