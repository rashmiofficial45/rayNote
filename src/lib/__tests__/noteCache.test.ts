import { NoteLRUCache } from '../noteCache.ts';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`❌ Assertion Failed: ${msg}`);
    throw new Error(msg);
  }
}

console.log('🧪 Starting NoteLRUCache Tests & Benchmarks...\n');

// 1. Basic Set & Get
{
  const cache = new NoteLRUCache(5, 1024 * 1024);
  cache.set('n1', 'Content 1', '2026-10-07T00:00:00Z', 'Preview 1', 150);
  const item = cache.get('n1');
  assert(item !== null, 'Item n1 should be retrieved');
  assert(item?.content === 'Content 1', 'Content should match');
  assert(item?.scrollTop === 150, 'ScrollTop should be 150');
  console.log('✅ Test 1: Basic Set & Get passed');
}

// 2. LRU Capacity Eviction (MAX_ENTRIES)
{
  const cache = new NoteLRUCache(3, 1024 * 1024);
  cache.set('n1', 'Content 1');
  cache.set('n2', 'Content 2');
  cache.set('n3', 'Content 3');
  assert(cache.size === 3, 'Size should be 3');

  // Adding n4 should evict n1 (oldest)
  cache.set('n4', 'Content 4');
  assert(cache.size === 3, 'Size should remain 3');
  assert(cache.get('n1') === undefined, 'n1 should be evicted');
  assert(cache.get('n2') !== undefined, 'n2 should still exist');
  assert(cache.get('n3') !== undefined, 'n3 should still exist');
  assert(cache.get('n4') !== undefined, 'n4 should still exist');

  // Access n2 (moves it to newest)
  cache.get('n2');
  // Add n5 -> n3 is now the oldest and should be evicted!
  cache.set('n5', 'Content 5');
  assert(cache.get('n3') === undefined, 'n3 should be evicted because n2 was refreshed');
  assert(cache.get('n2') !== undefined, 'n2 should still exist');
  console.log('✅ Test 2: LRU Capacity Eviction passed');
}

// 3. Memory Byte-Limit Eviction (MAX_CACHE_BYTES)
{
  // 100 KB limit, max 10 entries
  const limitBytes = 100 * 1024;
  const cache = new NoteLRUCache(10, limitBytes);
  
  // Create 30 KB strings
  const chunk30k = 'x'.repeat(15 * 1024); // 15,000 chars ~ 30,000 bytes UTF-16
  cache.set('n1', chunk30k);
  cache.set('n2', chunk30k);
  cache.set('n3', chunk30k);
  
  assert(cache.size === 3, 'Should hold 3 chunks (~90KB)');
  assert(cache.totalBytes <= limitBytes, 'Should be within memory limit');

  // Add 4th chunk (will push total over 100KB, forcing eviction of n1)
  cache.set('n4', chunk30k);
  assert(cache.get('n1') === undefined, 'n1 must be evicted to stay under 100KB limit');
  assert(cache.totalBytes <= limitBytes, `Total bytes (${cache.totalBytes}) must not exceed ${limitBytes}`);
  console.log(`✅ Test 3: Byte Limit Eviction passed (Total: ${cache.totalBytes} bytes / max: ${limitBytes})`);
}

// 4. Scroll Position Persistence
{
  const cache = new NoteLRUCache(5, 1024 * 1024);
  cache.set('n1', 'Hello world', undefined, undefined, 4200);
  assert(cache.getScrollTop('n1') === 4200, 'Scroll top should be 4200');

  cache.setScrollTop('n1', 7850);
  assert(cache.getScrollTop('n1') === 7850, 'Updated scroll top should be 7850');
  console.log('✅ Test 4: Scroll Position Persistence passed');
}

// 5. Update Content In-Place (Autosave Pipeline Integration)
{
  const cache = new NoteLRUCache(5, 1024 * 1024);
  cache.set('n1', 'Original Content', '2026-10-07T00:00:00Z', 'Preview 1', 500);
  
  cache.updateContent('n1', 'Edited Content', 'Updated Preview');
  const updated = cache.get('n1');
  assert(updated?.content === 'Edited Content', 'Content should be updated');
  assert(updated?.scrollTop === 500, 'Scroll top must be preserved');
  assert(updated?.preview === 'Updated Preview', 'Preview should be updated');
  console.log('✅ Test 5: In-Place Content Update passed');
}

// 6. BENCHMARK: Latency & Memory Throughput
{
  console.log('\n⚡ Running Benchmarks:');
  const cache = new NoteLRUCache(25, 8 * 1024 * 1024);
  const mediumDoc = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(500); // ~28 KB

  // Warm-up cache with 25 notes
  for (let i = 0; i < 25; i++) {
    cache.set(`note-${i}`, mediumDoc, new Date().toISOString(), `Preview for note ${i}`, i * 50);
  }

  // Measure Cache Hit Latency over 100,000 iterations
  const iterations = 100000;
  const startHit = performance.now();
  for (let i = 0; i < iterations; i++) {
    const key = `note-${i % 25}`;
    const entry = cache.get(key);
    if (!entry) throw new Error('Missing entry');
  }
  const endHit = performance.now();
  const totalHitTimeMs = endHit - startHit;
  const avgHitLatencyNs = ((totalHitTimeMs / iterations) * 1_000_000).toFixed(2);
  const opsPerSec = Math.round((iterations / totalHitTimeMs) * 1000).toLocaleString();

  console.log(`  ⏱️ Cache Hit Latency:       ${avgHitLatencyNs} ns / op (${opsPerSec} ops/sec)`);
  console.log(`  📊 Cache Memory Footprint:  ${(cache.totalBytes / (1024 * 1024)).toFixed(3)} MB across 25 medium notes`);

  // Measure Set/Eviction Latency
  const startSet = performance.now();
  for (let i = 25; i < 25 + iterations; i++) {
    cache.set(`note-${i}`, mediumDoc, new Date().toISOString(), 'Preview', 100);
  }
  const endSet = performance.now();
  const totalSetTimeMs = endSet - startSet;
  const avgSetLatencyNs = ((totalSetTimeMs / iterations) * 1_000_000).toFixed(2);
  console.log(`  ⏱️ Cache Write + Evict:     ${avgSetLatencyNs} ns / op`);
  console.log(`  🛡️ Final Entry Count:       ${cache.size} (Max limit 25 enforced)`);
  console.log(`  🛡️ Final Cache Size:        ${(cache.totalBytes / (1024 * 1024)).toFixed(3)} MB (Max limit 8 MB enforced)`);
}

console.log('\n🎉 ALL TESTS AND BENCHMARKS PASSED SUCCESSFULLY!');
