#ifndef IPRC_PROTOCOL_H
#define IPRC_PROTOCOL_H
#if defined(_KERNEL_MODE)
// Avoid pulling user-mode VC/UCRT runtime headers into WDK kernel headers.
typedef unsigned short uint16_t;
typedef unsigned int uint32_t;
typedef unsigned __int64 uint64_t;
#else
#include <stdint.h>
#endif
#include <stddef.h>

#define IPRC_ABI_VERSION 1u
#define IPRC_RULE_COUNT 256u
#define IPRC_MODE_OBSERVE 0u
#define IPRC_MODE_ENABLED 1u
#define IPRC_RULE_DROP 0u
#define IPRC_RULE_NATIVE 1u
#define IPRC_RULE_TAP 2u
#define IPRC_BREAK 1u
#define IPRC_E0 2u
#define IPRC_E1 4u
#define IPRC_REPEAT_TTL_MS 12000u
#define IPRC_QUEUE_CAPACITY 128u

// {D41D0D42-6B14-4BE8-AC51-8C3A87849041}; admin-only raw PDO.
#define IPRC_INTERFACE_GUID_INIT {0xd41d0d42,0x6b14,0x4be8,{0xac,0x51,0x8c,0x3a,0x87,0x84,0x90,0x41}}
#define IPRC_RAW_CLASS_GUID_INIT {0xc5198d31,0xbe87,0x4144,{0xa8,0x12,0x94,0x77,0x3d,0x72,0xe6,0x59}}

// Vendor IOCTLs, METHOD_BUFFERED. Explicit access bits, never FILE_ANY_ACCESS.
#define IPRC_IOCTL_STATUS ((0x8000u << 16) | (1u << 14) | (0x800u << 2))
#define IPRC_IOCTL_GET_POLICY ((0x8000u << 16) | (1u << 14) | (0x801u << 2))
#define IPRC_IOCTL_SET_POLICY ((0x8000u << 16) | (3u << 14) | (0x802u << 2))

typedef struct IPRC_PACKET {
    uint16_t UnitId, MakeCode, Flags, Reserved;
    uint32_t ExtraInformation;
} IPRC_PACKET;

typedef struct IPRC_RULE {
    uint16_t Type, Code, Flags, Reserved;
} IPRC_RULE;

typedef struct IPRC_POLICY {
    uint32_t Size, Version, Mode, Reserved;
    IPRC_RULE Rules[IPRC_RULE_COUNT];
} IPRC_POLICY;

typedef struct IPRC_SET_POLICY {
    IPRC_POLICY Policy;
    uint32_t Persist, Reserved;
} IPRC_SET_POLICY;

typedef struct IPRC_STATUS {
    uint32_t Size, Version, Mode, Connected;
    uint32_t QueueDepth, LastPersistStatus;
    uint64_t Accepted, Delivered, Suppressed, Repeats, Backpressure;
} IPRC_STATUS;

_Static_assert(sizeof(IPRC_PACKET) == 12, "keyboard packet ABI");
_Static_assert(sizeof(IPRC_RULE) == 8, "rule ABI");
_Static_assert(sizeof(IPRC_POLICY) == 2064, "policy ABI");
_Static_assert(sizeof(IPRC_SET_POLICY) == 2072, "set-policy ABI");
_Static_assert(sizeof(IPRC_STATUS) == 64, "status ABI");
#endif
