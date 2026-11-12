#include "iprc_core.h"

static void IpZero(void *buffer, size_t bytes)
{
    unsigned char *p = (unsigned char *)buffer;
    while (bytes--) *p++ = 0;
}

void IpDefaults(IPRC_POLICY *policy, uint32_t mode)
{
    static const uint16_t navigation[] = {0x48, 0x50, 0x4b, 0x4d, 0x1c};
    static const uint16_t media[][2] = {{0x03,0x30},{0x04,0x2e},{0x22,0x20},{0x2b,0x22}};
    size_t i;
    IpZero(policy, sizeof(*policy));
    policy->Size = sizeof(*policy);
    policy->Version = IPRC_ABI_VERSION;
    policy->Mode = mode;
    for (i = 0; i < sizeof(navigation)/sizeof(navigation[0]); ++i)
        policy->Rules[navigation[i]].Type = IPRC_RULE_NATIVE;
    for (i = 0; i < sizeof(media)/sizeof(media[0]); ++i) {
        IPRC_RULE *rule = &policy->Rules[media[i][0]];
        rule->Type = IPRC_RULE_TAP;
        rule->Code = media[i][1];
        rule->Flags = IPRC_E0;
    }
}

int IpValidatePolicy(const IPRC_POLICY *policy)
{
    size_t i;
    if (policy->Size != sizeof(*policy) || policy->Version != IPRC_ABI_VERSION ||
        policy->Mode > IPRC_MODE_ENABLED || policy->Reserved) return 0;
    for (i = 0; i < IPRC_RULE_COUNT; ++i) {
        const IPRC_RULE *r = &policy->Rules[i];
        if (r->Type > IPRC_RULE_TAP || r->Reserved) return 0;
        if (r->Type == IPRC_RULE_TAP) {
            if (!r->Code || r->Code >= 0xff || (r->Flags & ~IPRC_E0)) return 0;
        } else if (r->Code || r->Flags) return 0;
    }
    // The measured phantom has no physical button. Enabled mode always drops it.
    return policy->Rules[0x17].Type == IPRC_RULE_DROP;
}

void IpInitialize(IPRC_ENGINE *engine)
{
    IpZero(engine, sizeof(*engine));
    IpDefaults(&engine->Policy, IPRC_MODE_OBSERVE);
}

int IpAccept(IPRC_ENGINE *engine, const IPRC_PACKET *packet, uint64_t nowMs)
{
    IPRC_PACKET output[2];
    IPRC_PRESS next = {0};
    IPRC_PRESS *press = NULL;
    uint32_t n = 0, repeated = 0, i;
    const int down = !(packet->Flags & IPRC_BREAK);
    // Preserve protocol/overrun packets without interpreting them as user keys.
    if (packet->MakeCode >= 0xff || (packet->Flags & ~(IPRC_BREAK|IPRC_E0|IPRC_E1))) {
        output[n++] = *packet;
    } else {
        const uint32_t index = packet->MakeCode + ((packet->Flags & (IPRC_E0|IPRC_E1)) >> 1u) * IPRC_RULE_COUNT;
        press = &engine->Presses[index];
        next = *press;
        if (down) {
            if (!next.Held || (nowMs >= next.LastDownMs && nowMs - next.LastDownMs > IPRC_REPEAT_TTL_MS)) {
                next.Held = 1;
                next.Route = engine->Policy.Rules[packet->MakeCode];
                if (engine->Policy.Mode == IPRC_MODE_OBSERVE) next.Route.Type = IPRC_RULE_NATIVE;
            } else repeated = 1;
            next.LastDownMs = nowMs;
            if (next.Route.Type == IPRC_RULE_NATIVE) output[n++] = *packet;
            else if (next.Route.Type == IPRC_RULE_TAP && !repeated) {
                output[0] = output[1] = *packet;
                output[0].MakeCode = output[1].MakeCode = next.Route.Code;
                output[0].Flags = next.Route.Flags;
                output[1].Flags = (uint16_t)(next.Route.Flags | IPRC_BREAK);
                output[0].ExtraInformation = output[1].ExtraInformation = 0;
                output[0].Reserved = output[1].Reserved = 0;
                n = 2;
            }
        } else {
            const uint16_t route = next.Held ? next.Route.Type :
                (engine->Policy.Mode == IPRC_MODE_OBSERVE ? IPRC_RULE_NATIVE : engine->Policy.Rules[packet->MakeCode].Type);
            if (route == IPRC_RULE_NATIVE) output[n++] = *packet;
            next.Held = 0;
        }
    }
    if (n > IPRC_QUEUE_CAPACITY - engine->Count) {
        engine->Backpressure++;
        return 0; // No state change or input consumption; lower stack may retry.
    }
    if (press) *press = next;
    for (i = 0; i < n; ++i) {
        engine->Queue[(engine->Head + engine->Count) % IPRC_QUEUE_CAPACITY] = output[i];
        engine->Count++;
    }
    engine->Accepted++;
    if (!n) engine->Suppressed++;
    if (repeated && !n) engine->Repeats++;
    return 1;
}

const IPRC_PACKET *IpPeek(const IPRC_ENGINE *engine, uint32_t *count)
{
    const uint32_t tail = IPRC_QUEUE_CAPACITY - engine->Head;
    *count = engine->Count < tail ? engine->Count : tail;
    return &engine->Queue[engine->Head];
}

void IpConsume(IPRC_ENGINE *engine, uint32_t count)
{
    if (count > engine->Count) count = engine->Count;
    engine->Head = (engine->Head + count) % IPRC_QUEUE_CAPACITY;
    engine->Count -= count;
    engine->Delivered += count;
}

static uint16_t IpUpper(uint16_t ch) { return ch >= 'a' && ch <= 'z' ? (uint16_t)(ch - 32) : ch; }
static int IpBoundary(uint16_t ch) { return ch == '_' || ch == '&' || ch == '\\' || ch == 0; }
static int IpToken(const uint16_t *id, size_t length, const char *token)
{
    size_t start, j;
    for (start = 4; start < length; ++start) {
        if (start && !IpBoundary(id[start - 1])) continue;
        for (j = 0; token[j] && start+j < length && IpUpper(id[start+j]) == (uint16_t)token[j]; ++j) {}
        if (!token[j] && (start+j == length || IpBoundary(id[start+j]))) return 1;
    }
    return 0;
}

int IpIsRemoteId(const uint16_t *id, size_t length)
{
    if (!id || length < 4 || IpUpper(id[0]) != 'H' || IpUpper(id[1]) != 'I' ||
        IpUpper(id[2]) != 'D' || id[3] != '\\') return 0;
    return (IpToken(id,length,"VID&00020A5C") || IpToken(id,length,"VID_0A5C")) &&
        (IpToken(id,length,"PID&8502") || IpToken(id,length,"PID_8502"));
}
