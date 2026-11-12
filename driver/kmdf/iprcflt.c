#include "iprcflt.h"

C_ASSERT(sizeof(KEYBOARD_INPUT_DATA) == sizeof(IPRC_PACKET));
C_ASSERT(FIELD_OFFSET(KEYBOARD_INPUT_DATA, Flags) == offsetof(IPRC_PACKET, Flags));
C_ASSERT(FIELD_OFFSET(KEYBOARD_INPUT_DATA, ExtraInformation) == offsetof(IPRC_PACKET, ExtraInformation));

NTSTATUS DriverEntry(PDRIVER_OBJECT driverObject, PUNICODE_STRING registryPath)
{
    WDF_DRIVER_CONFIG config;
    WDF_DRIVER_CONFIG_INIT(&config, IpDeviceAdd);
    return WdfDriverCreate(driverObject, registryPath, WDF_NO_OBJECT_ATTRIBUTES, &config, WDF_NO_HANDLE);
}

static BOOLEAN IpTargetDevice(PWDFDEVICE_INIT init)
{
    WDFMEMORY memory;
    size_t bytes, length, at;
    const uint16_t *ids;
    BOOLEAN match = FALSE;
    NTSTATUS status;
    DECLARE_CONST_UNICODE_STRING(keyboardClass, L"{4D36E96B-E325-11CE-BFC1-08002BE10318}");
    UNICODE_STRING actual;
    status = WdfFdoInitAllocAndQueryProperty(init, DevicePropertyClassGuid,
        NonPagedPoolNx, WDF_NO_OBJECT_ATTRIBUTES, &memory);
    if (!NT_SUCCESS(status)) return FALSE;
    actual.Buffer = (PWSTR)WdfMemoryGetBuffer(memory, &bytes);
    if (bytes != keyboardClass.Length + sizeof(WCHAR) || actual.Buffer[bytes / sizeof(WCHAR) - 1] != 0) {
        WdfObjectDelete(memory); return FALSE;
    }
    actual.Length = keyboardClass.Length;
    actual.MaximumLength = (USHORT)bytes;
    match = RtlEqualUnicodeString(&actual, &keyboardClass, TRUE);
    WdfObjectDelete(memory);
    if (!match) return FALSE;
    match = FALSE;
    status = WdfFdoInitAllocAndQueryProperty(init, DevicePropertyHardwareID,
        NonPagedPoolNx, WDF_NO_OBJECT_ATTRIBUTES, &memory);
    if (!NT_SUCCESS(status)) return FALSE;
    ids = (const uint16_t *)WdfMemoryGetBuffer(memory, &bytes);
    if ((bytes & 1u) == 0) {
        const size_t units = bytes / sizeof(uint16_t);
        for (at = 0; at < units && ids[at]; at += length + 1) {
            for (length = 0; at + length < units && ids[at + length]; ++length) {}
            if (at + length == units) break; // Malformed, unterminated property.
            if (IpIsRemoteId(ids + at, length)) { match = TRUE; break; }
        }
    }
    WdfObjectDelete(memory);
    return match;
}

NTSTATUS IpDeviceAdd(WDFDRIVER driver, PWDFDEVICE_INIT init)
{
    WDFDEVICE device;
    WDF_OBJECT_ATTRIBUTES attributes;
    WDF_IO_QUEUE_CONFIG queue;
    WDF_PNPPOWER_EVENT_CALLBACKS power;
    WDF_TIMER_CONFIG timer;
    IPRC_DEVICE_CONTEXT *ctx;
    NTSTATUS status;
    UNREFERENCED_PARAMETER(driver);

    // Defense in depth beyond the exact-ID Extension INF. Never attach to an
    // unrelated keyboard even if this service is registered there accidentally.
    if (!IpTargetDevice(init)) return STATUS_SUCCESS;
    WdfFdoInitSetFilter(init);
    WdfDeviceInitSetDeviceType(init, FILE_DEVICE_KEYBOARD);
    WDF_PNPPOWER_EVENT_CALLBACKS_INIT(&power);
    power.EvtDeviceD0Entry = IpD0Entry;
    power.EvtDeviceD0Exit = IpD0Exit;
    WdfDeviceInitSetPnpPowerEventCallbacks(init, &power);
    WDF_OBJECT_ATTRIBUTES_INIT_CONTEXT_TYPE(&attributes, IPRC_DEVICE_CONTEXT);
    status = WdfDeviceCreate(&init, &attributes, &device);
    if (!NT_SUCCESS(status)) return status;
    ctx = IpGetDevice(device);
    IpInitialize(&ctx->Engine);
    WDF_OBJECT_ATTRIBUTES_INIT(&attributes);
    attributes.ParentObject = device;
    status = WdfSpinLockCreate(&attributes, &ctx->Lock);
    if (!NT_SUCCESS(status)) return status;
    WDF_TIMER_CONFIG_INIT(&timer, IpRetryOutput);
    timer.AutomaticSerialization = FALSE;
    status = WdfTimerCreate(&timer, &attributes, &ctx->RetryTimer);
    if (!NT_SUCCESS(status)) return status;
    WDF_IO_QUEUE_CONFIG_INIT_DEFAULT_QUEUE(&queue, WdfIoQueueDispatchParallel);
    queue.EvtIoInternalDeviceControl = IpInternalControl;
    status = WdfIoQueueCreate(device, &queue, WDF_NO_OBJECT_ATTRIBUTES, WDF_NO_HANDLE);
    if (!NT_SUCCESS(status)) return status;
    IpLoadPolicy(device);
    return IpCreateControl(device);
}

VOID IpInternalControl(WDFQUEUE queue, WDFREQUEST request, size_t outputLength,
    size_t inputLength, ULONG code)
{
    WDFDEVICE device = WdfIoQueueGetDevice(queue);
    IPRC_DEVICE_CONTEXT *ctx = IpGetDevice(device);
    PCONNECT_DATA connect;
    NTSTATUS status;
    WDF_REQUEST_SEND_OPTIONS options;
    UNREFERENCED_PARAMETER(outputLength);
    UNREFERENCED_PARAMETER(inputLength);

    if (code == IOCTL_INTERNAL_KEYBOARD_CONNECT) {
        if (ctx->Upper.ClassService) { WdfRequestComplete(request, STATUS_SHARING_VIOLATION); return; }
        status = WdfRequestRetrieveInputBuffer(request, sizeof(CONNECT_DATA), (PVOID *)&connect, NULL);
        if (!NT_SUCCESS(status)) { WdfRequestComplete(request, status); return; }
        ctx->Upper = *connect;
        connect->ClassDeviceObject = WdfDeviceWdmGetDeviceObject(device);
#pragma warning(push)
#pragma warning(disable:4152)
        connect->ClassService = (PVOID)IpServiceCallback;
#pragma warning(pop)
        WdfRequestFormatRequestUsingCurrentType(request);
        WdfRequestSetCompletionRoutine(request, IpConnectComplete, device);
        if (!WdfRequestSend(request, WdfDeviceGetIoTarget(device), WDF_NO_SEND_OPTIONS)) {
            status = WdfRequestGetStatus(request);
            *connect = ctx->Upper;
            RtlZeroMemory(&ctx->Upper, sizeof(ctx->Upper));
            WdfRequestComplete(request, status);
        }
        return;
    }
    // No i8042/ISR hooks: the target is a Bluetooth HID keyboard.
    WDF_REQUEST_SEND_OPTIONS_INIT(&options, WDF_REQUEST_SEND_OPTION_SEND_AND_FORGET);
    if (!WdfRequestSend(request, WdfDeviceGetIoTarget(device), &options))
        WdfRequestComplete(request, WdfRequestGetStatus(request));
}

VOID IpConnectComplete(WDFREQUEST request, WDFIOTARGET target,
    PWDF_REQUEST_COMPLETION_PARAMS parameters, WDFCONTEXT context)
{
    IPRC_DEVICE_CONTEXT *ctx = IpGetDevice((WDFDEVICE)context);
    UNREFERENCED_PARAMETER(target);
    if (!NT_SUCCESS(parameters->IoStatus.Status)) {
        PCONNECT_DATA connect;
        if (NT_SUCCESS(WdfRequestRetrieveInputBuffer(request, sizeof(CONNECT_DATA), (PVOID *)&connect, NULL)))
            *connect = ctx->Upper;
        RtlZeroMemory(&ctx->Upper, sizeof(ctx->Upper));
    }
    WdfRequestComplete(request, parameters->IoStatus.Status);
}

// Called with our spin lock held at DISPATCH_LEVEL. Kbdclass callbacks are
// nonblocking. Preserve partially accepted packets, including a pending key-up.
static VOID IpDrain(IPRC_DEVICE_CONTEXT *ctx)
{
    while (ctx->Online && ctx->Upper.ClassService && ctx->Engine.Count) {
        uint32_t count;
        ULONG accepted = 0;
        const IPRC_PACKET *packets = IpPeek(&ctx->Engine, &count);
        ((PSERVICE_CALLBACK_ROUTINE)ctx->Upper.ClassService)(ctx->Upper.ClassDeviceObject,
            (PKEYBOARD_INPUT_DATA)packets, (PKEYBOARD_INPUT_DATA)(packets + count), &accepted);
        if (accepted > count) accepted = count;
        if (!accepted) break;
        IpConsume(&ctx->Engine, accepted);
    }
    if (ctx->Online && ctx->Engine.Count)
        WdfTimerStart(ctx->RetryTimer, WDF_REL_TIMEOUT_IN_MS(10));
}

VOID IpServiceCallback(PDEVICE_OBJECT object, PKEYBOARD_INPUT_DATA start,
    PKEYBOARD_INPUT_DATA end, PULONG consumed)
{
    IPRC_DEVICE_CONTEXT *ctx = IpGetDevice(WdfWdmDeviceGetWdfDeviceHandle(object));
    ULONG accepted = 0;
    WdfSpinLockAcquire(ctx->Lock);
    IpDrain(ctx);
    for (; start < end; ++start) {
        if (!IpAccept(&ctx->Engine, (const IPRC_PACKET *)start, KeQueryInterruptTime() / 10000u)) break;
        ++accepted;
        IpDrain(ctx);
    }
    *consumed += accepted;
    WdfSpinLockRelease(ctx->Lock);
}

VOID IpRetryOutput(WDFTIMER timer)
{
    IPRC_DEVICE_CONTEXT *ctx = IpGetDevice((WDFDEVICE)WdfTimerGetParentObject(timer));
    WdfSpinLockAcquire(ctx->Lock);
    IpDrain(ctx);
    WdfSpinLockRelease(ctx->Lock);
}

NTSTATUS IpD0Entry(WDFDEVICE device, WDF_POWER_DEVICE_STATE previous)
{
    IPRC_DEVICE_CONTEXT *ctx = IpGetDevice(device);
    UNREFERENCED_PARAMETER(previous);
    WdfSpinLockAcquire(ctx->Lock);
    ctx->Online = TRUE;
    // Wake queued output at DISPATCH_LEVEL via the timer, not at PASSIVE here.
    if (ctx->Engine.Count) WdfTimerStart(ctx->RetryTimer, WDF_REL_TIMEOUT_IN_MS(10));
    WdfSpinLockRelease(ctx->Lock);
    return STATUS_SUCCESS;
}

NTSTATUS IpD0Exit(WDFDEVICE device, WDF_POWER_DEVICE_STATE target)
{
    IPRC_DEVICE_CONTEXT *ctx = IpGetDevice(device);
    UNREFERENCED_PARAMETER(target);
    WdfSpinLockAcquire(ctx->Lock);
    ctx->Online = FALSE;
    WdfSpinLockRelease(ctx->Lock);
    WdfTimerStop(ctx->RetryTimer, TRUE);
    // Keep queued packet pairs across sleep; device removal destroys the context.
    return STATUS_SUCCESS;
}
