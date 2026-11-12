#include <assert.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "../core/iprc_core.h"

static IPRC_ENGINE Engine;
static unsigned Checks;
#define CHECK(expr) do { ++Checks; if (!(expr)) { fprintf(stderr,"FAIL line %d: %s\n",__LINE__,#expr); exit(1); } } while (0)

static IPRC_PACKET Key(uint16_t code, uint16_t flags)
{
    IPRC_PACKET p = {7,code,flags,0,0x1234}; return p;
}
static void Reset(uint32_t mode) { IpInitialize(&Engine); IpDefaults(&Engine.Policy,mode); }
static uint32_t Read(IPRC_PACKET *out)
{
    uint32_t count, total=0, i;
    while (Engine.Count) {
        const IPRC_PACKET *p=IpPeek(&Engine,&count);
        for(i=0;i<count;++i)out[total++]=p[i];
        IpConsume(&Engine,count);
    }
    return total;
}
static int Id(const char *s)
{
    uint16_t wide[256]; size_t i,n=strlen(s);
    assert(n<256); for(i=0;i<n;++i)wide[i]=(uint16_t)(unsigned char)s[i];
    return IpIsRemoteId(wide,n);
}

static void Identity(void)
{
    CHECK(Id("HID\\{GUID}_VID&00020a5c_PID&8502"));
    CHECK(Id("HID\\VID_0A5C&PID_8502&Col01"));
    CHECK(!Id("USB\\VID_0A5C&PID_8502"));
    CHECK(!Id("HID\\VID_1234&PID_8502"));
    CHECK(!Id("HID\\VID_0A5C&PID_1234&SERIAL_8502"));
    CHECK(!Id("HID\\VID_0A5C&PID_85020"));
    CHECK(!Id("HID\\VID_0A5C0&PID_8502"));
    CHECK(!Id("HID\\XVID_0A5C&PID_8502"));
    CHECK(!Id("HID\\VID_0A5C&XPID_8502"));
    CHECK(!IpIsRemoteId(NULL,0));
}
static void Validation(void)
{
    IPRC_POLICY p;
    IpDefaults(&p,IPRC_MODE_ENABLED); CHECK(IpValidatePolicy(&p));
    p.Version++; CHECK(!IpValidatePolicy(&p)); p.Version--;
    p.Size--; CHECK(!IpValidatePolicy(&p)); p.Size++;
    p.Mode=3; CHECK(!IpValidatePolicy(&p)); p.Mode=1;
    p.Reserved=1; CHECK(!IpValidatePolicy(&p)); p.Reserved=0;
    p.Rules[50].Type=3; CHECK(!IpValidatePolicy(&p)); p.Rules[50].Type=0;
    p.Rules[50].Code=42; CHECK(!IpValidatePolicy(&p)); p.Rules[50].Code=0;
    p.Rules[50].Reserved=1; CHECK(!IpValidatePolicy(&p)); p.Rules[50].Reserved=0;
    p.Rules[50].Type=IPRC_RULE_TAP; CHECK(!IpValidatePolicy(&p));
    p.Rules[50].Code=0xff; CHECK(!IpValidatePolicy(&p));
    p.Rules[50].Code=0x7c; p.Rules[50].Flags=IPRC_BREAK; CHECK(!IpValidatePolicy(&p));
    p.Rules[50].Flags=IPRC_E0; CHECK(IpValidatePolicy(&p));
    p.Rules[0x17].Type=IPRC_RULE_NATIVE; CHECK(!IpValidatePolicy(&p));
}
static void Mapping(void)
{
    IPRC_PACKET out[IPRC_QUEUE_CAPACITY], p;
    uint32_t i;
    Reset(IPRC_MODE_OBSERVE);
    CHECK(Engine.Policy.Mode==IPRC_MODE_OBSERVE);
    p=Key(50,0); CHECK(IpAccept(&Engine,&p,0)); CHECK(IpAccept(&Engine,&p,6000));
    p.Flags=IPRC_BREAK; CHECK(IpAccept(&Engine,&p,6001));
    CHECK(Read(out)==3); CHECK(out[0].MakeCode==50 && out[2].ExtraInformation==0x1234);
    Reset(IPRC_MODE_ENABLED);
    p=Key(50,0); CHECK(IpAccept(&Engine,&p,0));
    for(i=1;i<=50;++i)CHECK(IpAccept(&Engine,&p,6000u*i));
    CHECK(Read(out)==0); CHECK(Engine.Repeats==50);
    p=Key(0x17,0); CHECK(IpAccept(&Engine,&p,1)); CHECK(Read(out)==0);
    p=Key(0x48,IPRC_E0); CHECK(IpAccept(&Engine,&p,2)); CHECK(IpAccept(&Engine,&p,3));
    p.Flags|=IPRC_BREAK; CHECK(IpAccept(&Engine,&p,4)); CHECK(Read(out)==3);
    CHECK(out[0].Flags==IPRC_E0 && out[2].Flags==(IPRC_E0|IPRC_BREAK));
    p=Key(3,0); CHECK(IpAccept(&Engine,&p,10)); CHECK(Read(out)==2);
    CHECK(out[0].MakeCode==0x30 && out[0].Flags==IPRC_E0);
    CHECK(out[1].MakeCode==0x30 && out[1].Flags==(IPRC_E0|IPRC_BREAK));
    CHECK(out[0].ExtraInformation==0 && out[0].UnitId==7);
    CHECK(IpAccept(&Engine,&p,6010)); CHECK(Read(out)==0);
    CHECK(IpAccept(&Engine,&p,18011)); CHECK(Read(out)==2); // TTL after a genuinely silent period.
    p.Flags=IPRC_BREAK; CHECK(IpAccept(&Engine,&p,18012)); CHECK(Read(out)==0);
    p.Flags=0; CHECK(IpAccept(&Engine,&p,18013)); CHECK(Read(out)==2);
    p=Key(0xff,0); CHECK(IpAccept(&Engine,&p,20)); CHECK(Read(out)==1); // overrun notification
}
static void Reconfiguration(void)
{
    IPRC_PACKET out[IPRC_QUEUE_CAPACITY],p=Key(0x48,IPRC_E0);
    Reset(IPRC_MODE_ENABLED);
    CHECK(IpAccept(&Engine,&p,1));
    Engine.Policy.Rules[0x48].Type=IPRC_RULE_DROP;
    p.Flags|=IPRC_BREAK; CHECK(IpAccept(&Engine,&p,2));
    CHECK(Read(out)==2); CHECK(out[1].Flags==(IPRC_E0|IPRC_BREAK));
    p.Flags=IPRC_E0; CHECK(IpAccept(&Engine,&p,3)); CHECK(Read(out)==0);
    Engine.Policy.Mode=IPRC_MODE_OBSERVE;
    p.Flags|=IPRC_BREAK; CHECK(IpAccept(&Engine,&p,4)); CHECK(Read(out)==0); // same press keeps its route
    p.Flags=IPRC_E0; CHECK(IpAccept(&Engine,&p,5)); CHECK(Read(out)==1);
}
static void Backpressure(void)
{
    IPRC_PACKET p=Key(3,0), out[IPRC_QUEUE_CAPACITY];
    uint32_t i,count;
    Reset(IPRC_MODE_ENABLED);
    for(i=0;i<IPRC_QUEUE_CAPACITY/2;++i){
        p.Flags=0; CHECK(IpAccept(&Engine,&p,i*2));
        p.Flags=IPRC_BREAK; CHECK(IpAccept(&Engine,&p,i*2+1));
    }
    CHECK(Engine.Count==IPRC_QUEUE_CAPACITY);
    p.Flags=0; CHECK(!IpAccept(&Engine,&p,1000));
    CHECK(Engine.Backpressure==1 && !Engine.Presses[3].Held);
    (void)IpPeek(&Engine,&count); CHECK(count>0);
    IpConsume(&Engine,1); CHECK(Engine.Queue[Engine.Head].Flags==(IPRC_E0|IPRC_BREAK));
    CHECK(!IpAccept(&Engine,&p,1001)); // one free slot cannot accept a pair
    IpConsume(&Engine,1); CHECK(IpAccept(&Engine,&p,1002)); // retry is still a fresh down
    CHECK(Read(out)==IPRC_QUEUE_CAPACITY);
    CHECK(out[IPRC_QUEUE_CAPACITY-2].Flags==IPRC_E0 && out[IPRC_QUEUE_CAPACITY-1].Flags==(IPRC_E0|IPRC_BREAK));
    IpConsume(&Engine,999); CHECK(Engine.Count==0); // defensive clamp
}
static void Stress(void)
{
    uint32_t i;
    IPRC_PACKET p,out[IPRC_QUEUE_CAPACITY];
    Reset(IPRC_MODE_ENABLED);
    for(i=0;i<20000;++i){
        p=Key(3,0); CHECK(IpAccept(&Engine,&p,(uint64_t)i*2));
        p.Flags=IPRC_BREAK; CHECK(IpAccept(&Engine,&p,(uint64_t)i*2+1));
        CHECK(Read(out)==2);
        CHECK(out[0].Flags==IPRC_E0 && out[1].Flags==(IPRC_E0|IPRC_BREAK));
    }
    CHECK(Engine.Delivered==40000 && Engine.Count==0);
}
int main(void)
{
    Identity(); Validation(); Mapping(); Reconfiguration(); Backpressure(); Stress();
    printf("PASS %u checks; real shared C core; no driver loaded\n",Checks);
    return 0;
}
