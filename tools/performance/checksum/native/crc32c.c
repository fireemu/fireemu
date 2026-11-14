#include <stddef.h>
#include <stdint.h>

static uint64_t load_le64(const uint8_t *bytes) {
    uint64_t value = 0;
    for (unsigned int index = 0; index < 8; ++index) {
        value |= (uint64_t)bytes[index] << (index * 8);
    }
    return value;
}

#if defined(__x86_64__)
#include <nmmintrin.h>

__attribute__((target("sse4.2")))
uint32_t crc32c_c_hw(uint32_t state, const uint8_t *bytes, size_t len) {
    size_t offset = 0;
    while (len - offset >= 8) {
        state = (uint32_t)_mm_crc32_u64((uint64_t)state, load_le64(bytes + offset));
        offset += 8;
    }
    while (offset < len) {
        state = _mm_crc32_u8(state, bytes[offset]);
        ++offset;
    }
    return state;
}
#elif defined(__aarch64__)
#include <arm_acle.h>

__attribute__((target("+crc")))
uint32_t crc32c_c_hw(uint32_t state, const uint8_t *bytes, size_t len) {
    size_t offset = 0;
    while (len - offset >= 8) {
        state = __crc32cd(state, load_le64(bytes + offset));
        offset += 8;
    }
    while (offset < len) {
        state = __crc32cb(state, bytes[offset]);
        ++offset;
    }
    return state;
}
#endif
