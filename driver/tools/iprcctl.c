#define UNICODE
#define _UNICODE
#include <windows.h>
#include <setupapi.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "../core/iprc_core.h"

static const GUID IpInterface = IPRC_INTERFACE_GUID_INIT;
static const GUID KeyboardClass = {0x4d36e96b,0xe325,0x11ce,{0xbf,0xc1,0x08,0x00,0x2b,0xe1,0x03,0x18}};

static void Error(const char *operation)
{ fprintf(stderr,"%s failed: Windows error %lu\n",operation,(unsigned long)GetLastError()); }

static int Inventory(void)
{
    HDEVINFO set = SetupDiGetClassDevsW(&KeyboardClass,NULL,NULL,DIGCF_PRESENT);
    SP_DEVINFO_DATA device;
    DWORD index=0;
    int found=0;
    if(set==INVALID_HANDLE_VALUE){Error("enumerate keyboards");return 1;}
    memset(&device,0,sizeof(device)); device.cbSize=sizeof(device);
    while(SetupDiEnumDeviceInfo(set,index++,&device)){
        WCHAR ids[4096];DWORD type=0,bytes=0;size_t at,n,units;
        if(!SetupDiGetDeviceRegistryPropertyW(set,&device,SPDRP_HARDWAREID,&type,(PBYTE)ids,sizeof(ids),&bytes))continue;
        if(type!=REG_MULTI_SZ||(bytes&1u))continue;
        units=bytes/sizeof(WCHAR);
        for(at=0;at<units&&ids[at];at+=n+1){
            for(n=0;at+n<units&&ids[at+n];++n){}
            if(at+n==units)break;
            if(IpIsRemoteId((const uint16_t *)(ids+at),n)){
                WCHAR instance[1024];
                if(SetupDiGetDeviceInstanceIdW(set,&device,instance,1024,NULL))wprintf(L"Instance: %ls\n",instance);
                wprintf(L"HardwareId: %ls\n",ids+at);
                wprintf(L"Class: Keyboard; verified VID and PID\n");
                found++;break;
            }
        }
    }
    SetupDiDestroyDeviceInfoList(set);
    if(!found)puts("No present IPRC1000 keyboard found. Wake/pair the remote and retry.");
    return found?0:2;
}

static HANDLE Open(unsigned wanted)
{
    HDEVINFO set=SetupDiGetClassDevsW(&IpInterface,NULL,NULL,DIGCF_PRESENT|DIGCF_DEVICEINTERFACE);
    SP_DEVICE_INTERFACE_DATA item;
    SP_DEVICE_INTERFACE_DETAIL_DATA_W *detail;
    DWORD required=0;
    DWORD error=ERROR_SUCCESS;
    const char *stage="enumerate control interfaces";
    HANDLE handle=INVALID_HANDLE_VALUE;
    if(set==INVALID_HANDLE_VALUE){Error("enumerate control interfaces");return handle;}
    memset(&item,0,sizeof(item));item.cbSize=sizeof(item);
    if(!SetupDiEnumDeviceInterfaces(set,NULL,&IpInterface,wanted,&item)){error=GetLastError();goto done;}
    stage="read control interface size";
    SetupDiGetDeviceInterfaceDetailW(set,&item,NULL,0,&required,NULL);
    if(!required||required>65536){error=GetLastError();goto done;}
    detail=(SP_DEVICE_INTERFACE_DETAIL_DATA_W *)malloc(required);
    if(!detail){error=ERROR_NOT_ENOUGH_MEMORY;goto done;}
    detail->cbSize=sizeof(*detail);
    stage="read control interface path";
    if(SetupDiGetDeviceInterfaceDetailW(set,&item,detail,required,NULL,NULL)) {
        stage="open control interface";
        handle=CreateFileW(detail->DevicePath,GENERIC_READ|GENERIC_WRITE,0,NULL,OPEN_EXISTING,0,NULL);
    }
    if(handle==INVALID_HANDLE_VALUE)error=GetLastError();
    free(detail);
done:
    SetupDiDestroyDeviceInfoList(set);
    if(handle==INVALID_HANDLE_VALUE){
        fprintf(stderr,"Control unavailable at '%s': Windows error %lu.\n",stage,(unsigned long)error);
        if(error==ERROR_ACCESS_DENIED)fputs("Access denied. Run this command in an administrator terminal.\n",stderr);
        else if(error==ERROR_NO_MORE_ITEMS)fputs("No active control interface at this index. Wake/connect the remote, then check driver/device startup.\n",stderr);
        else if(error==ERROR_SHARING_VIOLATION)fputs("Another process has the exclusive control handle open. Close that process and retry.\n",stderr);
    }
    return handle;
}

static int GetPolicy(HANDLE handle,IPRC_POLICY *policy)
{
    DWORD bytes=0;
    if(!DeviceIoControl(handle,IPRC_IOCTL_GET_POLICY,NULL,0,policy,sizeof(*policy),&bytes,NULL)){
        Error("get policy");return 0;
    }
    if(bytes!=sizeof(*policy)||!IpValidatePolicy(policy)){fprintf(stderr,"Unexpected driver ABI\n");return 0;}
    return 1;
}

static int Number(const char *text,unsigned *value)
{
    char *end;unsigned long v;
    if(!*text||*text=='-')return 0;
    v=strtoul(text,&end,0);
    if(*end||v>=0xff)return 0;
    *value=(unsigned)v;return 1;
}

int main(int argc,char **argv)
{
    HANDLE handle;
    DWORD bytes=0;
    IPRC_SET_POLICY change;
    int result=1,i;
    unsigned device=0,input=0,output=0;
    if(argc<2||!strcmp(argv[1],"help")||!strcmp(argv[1],"--help")){
        puts("IPRC1000 driver control (prototype ABI 1)\n"
             "  iprcctl inventory                 read-only physical keyboard discovery\n"
             "  iprcctl status [--device N]\n"
             "  iprcctl snapshot                   read status and all rules as JSON\n"
             "  iprcctl apply FILE [--persist]      validated ABI-1 binary policy\n"
             "  iprcctl enable [--persist]        enable safe built-in mapping\n"
             "  iprcctl observe [--persist]       pass future presses through\n"
             "  iprcctl map INPUT native|drop [--persist]\n"
             "  iprcctl map INPUT tap OUTPUT [e0] [--persist]\n"
             "Numbers accept 0x hex. Default control interface is device 0.\n"
             "Persistence is opt-in; it survives device reconnection. No installation commands.");
        return 0;
    }
    if(!strcmp(argv[1],"inventory"))return Inventory();
    memset(&change,0,sizeof(change));
    for(i=2;i<argc;++i){
        if(!strcmp(argv[i],"--persist"))change.Persist=1;
        if(!strcmp(argv[i],"--device")){
            if(++i>=argc||!Number(argv[i],&device)){fputs("Invalid device index\n",stderr);return 1;}
        }
    }
    if(strcmp(argv[1],"status")&&strcmp(argv[1],"snapshot")&&strcmp(argv[1],"apply")&&strcmp(argv[1],"enable")&&strcmp(argv[1],"observe")&&strcmp(argv[1],"map")){
        fputs("Unknown command; use help\n",stderr);return 1;
    }
    handle=Open(device);if(handle==INVALID_HANDLE_VALUE)return 2;
    if(!strcmp(argv[1],"snapshot")){
        IPRC_STATUS status;
        if(!DeviceIoControl(handle,IPRC_IOCTL_STATUS,NULL,0,&status,sizeof(status),&bytes,NULL))Error("status");
        else if(bytes!=sizeof(status)||status.Version!=IPRC_ABI_VERSION)fputs("Unexpected driver ABI\n",stderr);
        else if(GetPolicy(handle,&change.Policy)){
            unsigned n;
            printf("{\"mode\":%u,\"connected\":%u,\"queued\":%u,\"lastPersistStatus\":%u,"
                "\"accepted\":\"%llu\",\"delivered\":\"%llu\",\"suppressed\":\"%llu\",\"rules\":[",
                change.Policy.Mode,status.Connected,status.QueueDepth,status.LastPersistStatus,
                (unsigned long long)status.Accepted,(unsigned long long)status.Delivered,(unsigned long long)status.Suppressed);
            for(n=0;n<IPRC_RULE_COUNT;++n){
                const IPRC_RULE *r=&change.Policy.Rules[n];
                printf("%s{\"type\":%u,\"code\":%u,\"flags\":%u}",n?",":"",r->Type,r->Code,r->Flags);
            }
            puts("]}");result=0;
        }
    }else if(!strcmp(argv[1],"status")){
        IPRC_STATUS status;
        if(!DeviceIoControl(handle,IPRC_IOCTL_STATUS,NULL,0,&status,sizeof(status),&bytes,NULL))Error("status");
        else if(bytes!=sizeof(status)||status.Version!=IPRC_ABI_VERSION)fputs("Unexpected driver ABI\n",stderr);
        else{
            printf("mode=%s connected=%u queued=%u accepted=%llu delivered=%llu suppressed=%llu repeats=%llu backpressure=%llu\n",
                status.Mode==IPRC_MODE_ENABLED?"enabled":"observe",status.Connected,status.QueueDepth,
                (unsigned long long)status.Accepted,(unsigned long long)status.Delivered,
                (unsigned long long)status.Suppressed,(unsigned long long)status.Repeats,(unsigned long long)status.Backpressure);
            result=0;
        }
    }else{
        if(!strcmp(argv[1],"apply")){
            FILE *file;
            size_t read;
            int extra;
            if(argc<3){fputs("Expected binary policy file\n",stderr);goto done;}
            file=fopen(argv[2],"rb");
            if(!file){fputs("Cannot open policy file\n",stderr);goto done;}
            read=fread(&change.Policy,1,sizeof(change.Policy),file);
            extra=fgetc(file);
            if(read!=sizeof(change.Policy)||extra!=EOF||ferror(file)){
                fclose(file);fputs("Invalid policy file length\n",stderr);goto done;
            }
            fclose(file);
        }
        else if(!strcmp(argv[1],"enable"))IpDefaults(&change.Policy,IPRC_MODE_ENABLED);
        else if(!GetPolicy(handle,&change.Policy))goto done;
        if(!strcmp(argv[1],"observe"))change.Policy.Mode=IPRC_MODE_OBSERVE;
        if(!strcmp(argv[1],"map")){
            IPRC_RULE rule={0,0,0,0};
            if(argc<4||!Number(argv[2],&input)){fputs("Invalid input scan code\n",stderr);goto done;}
            if(!strcmp(argv[3],"native"))rule.Type=IPRC_RULE_NATIVE;
            else if(!strcmp(argv[3],"tap")){
                if(argc<5||!Number(argv[4],&output)||!output){fputs("Invalid output scan code\n",stderr);goto done;}
                rule.Type=IPRC_RULE_TAP;rule.Code=(uint16_t)output;
                if(argc>5&&!strcmp(argv[5],"e0"))rule.Flags=IPRC_E0;
            }else if(strcmp(argv[3],"drop")){fputs("Expected native, drop or tap\n",stderr);goto done;}
            change.Policy.Rules[input]=rule;
        }
        if(!IpValidatePolicy(&change.Policy)){fputs("Policy rejected by local validator\n",stderr);goto done;}
        if(!DeviceIoControl(handle,IPRC_IOCTL_SET_POLICY,&change,sizeof(change),NULL,0,&bytes,NULL))Error("set policy");
        else{printf("Policy applied%s; mapping runs inside the driver without this process.\n",change.Persist?" and saved":" in RAM");result=0;}
    }
done:
    CloseHandle(handle);return result;
}
