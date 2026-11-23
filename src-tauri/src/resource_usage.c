#include <libproc.h>
#include <stdbool.h>
#include <mach/mach.h>
#include <sys/resource.h>
#include <time.h>
#include <unistd.h>

typedef struct {
    uint64_t start;
    uint64_t cpu_ns;
    uint64_t footprint_bytes;
    uint64_t gpu_ns;
    bool gpu_available;
} RaynoteProcessUsage;

bool raynote_process_usage(pid_t pid, RaynoteProcessUsage *usage) {
    struct rusage_info_v0 info = {0};
    if (proc_pid_rusage(pid, RUSAGE_INFO_V0, (rusage_info_t *)&info) != 0)
        return false;

    usage->start = info.ri_proc_start_abstime;
    usage->cpu_ns = info.ri_user_time + info.ri_system_time;
    usage->footprint_bytes = info.ri_phys_footprint;

#if defined(__x86_64__)
    task_name_t task = mach_task_self();
    const bool own_task = pid == getpid();
    if (!own_task && task_name_for_pid(mach_task_self(), pid, &task) != KERN_SUCCESS)
        return true;

    task_power_info_v2_data_t power = {0};
    mach_msg_type_number_t count = TASK_POWER_INFO_V2_COUNT;
    if (task_info(task, TASK_POWER_INFO_V2, (task_info_t)&power, &count) == KERN_SUCCESS &&
        count >= TASK_POWER_INFO_V2_COUNT_OLD) {
        usage->gpu_available = true;
        usage->gpu_ns = power.gpu_energy.task_gpu_utilisation;
    }
    if (!own_task)
        mach_port_deallocate(mach_task_self(), task);
#endif
    return true;
}

uint64_t raynote_sample_uptime(void) {
    return clock_gettime_nsec_np(CLOCK_UPTIME_RAW);
}

#if defined(__arm64__)
#include <CoreFoundation/CoreFoundation.h>
#include <IOKit/IOKitLib.h>
#include <stdlib.h>
#include <string.h>

// AGX publishes cumulative GPU execution time per API and client, in nanoseconds.
bool raynote_gpu_usage(const pid_t *pids, size_t count, uint64_t *times) {
    io_iterator_t accelerators;
    if (IOServiceGetMatchingServices(MACH_PORT_NULL, IOServiceMatching("IOAccelerator"),
            &accelerators) != KERN_SUCCESS)
        return false;

    bool has_usage = false;
    io_service_t accelerator;
    while ((accelerator = IOIteratorNext(accelerators))) {
        io_iterator_t clients;
        if (IORegistryEntryGetChildIterator(accelerator, kIOServicePlane, &clients) == KERN_SUCCESS) {
            io_registry_entry_t client;
            while ((client = IOIteratorNext(clients))) {
                CFTypeRef creator = IORegistryEntryCreateCFProperty(client, CFSTR("IOUserClientCreator"), NULL, 0);
                char owner[256];
                if (creator && CFGetTypeID(creator) == CFStringGetTypeID() &&
                    CFStringGetCString(creator, owner, sizeof(owner), kCFStringEncodingUTF8) &&
                    strncmp(owner, "pid ", 4) == 0) {
                    const pid_t pid = (pid_t)strtol(owner + 4, NULL, 10);
                    size_t index = 0;
                    while (index < count && pids[index] != pid) index++;

                    if (index < count || !has_usage) {
                        CFTypeRef usage = IORegistryEntryCreateCFProperty(client, CFSTR("AppUsage"), NULL, 0);
                        if (usage && CFGetTypeID(usage) == CFArrayGetTypeID()) {
                            for (CFIndex n = 0; n < CFArrayGetCount(usage); n++) {
                                CFTypeRef entry = CFArrayGetValueAtIndex(usage, n);
                                if (CFGetTypeID(entry) != CFDictionaryGetTypeID()) continue;
                                CFTypeRef number = CFDictionaryGetValue(entry, CFSTR("accumulatedGPUTime"));
                                int64_t ns;
                                if (number && CFGetTypeID(number) == CFNumberGetTypeID() &&
                                    CFNumberGetValue(number, kCFNumberSInt64Type, &ns) && ns >= 0) {
                                    has_usage = true;
                                    if (index < count) times[index] += (uint64_t)ns;
                                }
                            }
                        }
                        if (usage) CFRelease(usage);
                    }
                }
                if (creator) CFRelease(creator);
                IOObjectRelease(client);
            }
            IOObjectRelease(clients);
        }
        IOObjectRelease(accelerator);
    }
    IOObjectRelease(accelerators);
    return has_usage;
}
#endif
