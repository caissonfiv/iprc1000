#ifndef IPRC_FILTER_H
#define IPRC_FILTER_H
#if !defined(KMDF_VERSION_MAJOR) || !defined(KMDF_VERSION_MINOR) || !defined(KMDF_MINIMUM_VERSION_REQUIRED)
#error Define the KMDF target and minimum versions explicitly before including WDF headers.
#elif KMDF_VERSION_MAJOR != 1 || KMDF_VERSION_MINOR != 33 || KMDF_MINIMUM_VERSION_REQUIRED != 33
#error This driver must match its KMDF 1.33 headers, libraries and INF.
#endif
#include <ntddk.h>
#include <kbdmou.h>
#include <ntddkbd.h>
#include <wdf.h>
#include <wdmsec.h>
#include <ntstrsafe.h>
#include "../core/iprc_core.h"

typedef struct IPRC_DEVICE_CONTEXT {
    CONNECT_DATA Upper;
    WDFSPINLOCK Lock;
    WDFTIMER RetryTimer;
    BOOLEAN Online;
    NTSTATUS LastPersistStatus;
    IPRC_ENGINE Engine;
} IPRC_DEVICE_CONTEXT;
WDF_DECLARE_CONTEXT_TYPE_WITH_NAME(IPRC_DEVICE_CONTEXT, IpGetDevice)

typedef struct IPRC_CONTROL_CONTEXT { WDFDEVICE Parent; } IPRC_CONTROL_CONTEXT;
WDF_DECLARE_CONTEXT_TYPE_WITH_NAME(IPRC_CONTROL_CONTEXT, IpGetControl)

DRIVER_INITIALIZE DriverEntry;
EVT_WDF_DRIVER_DEVICE_ADD IpDeviceAdd;
EVT_WDF_IO_QUEUE_IO_INTERNAL_DEVICE_CONTROL IpInternalControl;
EVT_WDF_REQUEST_COMPLETION_ROUTINE IpConnectComplete;
EVT_WDF_TIMER IpRetryOutput;
EVT_WDF_DEVICE_D0_ENTRY IpD0Entry;
EVT_WDF_DEVICE_D0_EXIT IpD0Exit;
EVT_WDF_IO_QUEUE_IO_DEVICE_CONTROL IpDeviceControl;

VOID IpServiceCallback(PDEVICE_OBJECT deviceObject, PKEYBOARD_INPUT_DATA start,
    PKEYBOARD_INPUT_DATA end, PULONG consumed);
NTSTATUS IpCreateControl(WDFDEVICE parent);
VOID IpLoadPolicy(WDFDEVICE device);
#endif
