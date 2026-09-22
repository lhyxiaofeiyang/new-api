package observability

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestResolveRangeDefaultsAndBoundaries(t *testing.T) {
	now := testNow()

	t.Run("default range is applied", func(t *testing.T) {
		r, err := resolveRange("", 0, 0, Range24h, now)
		require.NoError(t, err)
		assert.Equal(t, Range24h, r.Range)
		assert.Equal(t, now.Unix(), r.End)
		assert.Equal(t, now.Add(-24*time.Hour).Unix(), r.Start)
	})

	t.Run("today starts at local midnight", func(t *testing.T) {
		r, err := resolveRange(RangeToday, 0, 0, Range24h, now)
		require.NoError(t, err)
		midnight := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.Local)
		assert.Equal(t, midnight.Unix(), r.Start)
		assert.Equal(t, now.Unix(), r.End)
	})

	t.Run("custom range is passed through unchanged", func(t *testing.T) {
		r, err := resolveRange(RangeCustom, 1000, 2000, Range24h, now)
		require.NoError(t, err)
		assert.Equal(t, int64(1000), r.Start)
		assert.Equal(t, int64(2000), r.End)
	})

	t.Run("custom range requires both bounds", func(t *testing.T) {
		_, err := resolveRange(RangeCustom, 1000, 0, Range24h, now)
		require.Error(t, err)
	})

	t.Run("empty and inverted ranges are rejected", func(t *testing.T) {
		_, err := resolveRange(RangeCustom, 2000, 2000, Range24h, now)
		require.Error(t, err)
		_, err = resolveRange(RangeCustom, 3000, 2000, Range24h, now)
		require.Error(t, err)
	})

	t.Run("oversized range is rejected", func(t *testing.T) {
		_, err := resolveRange(RangeCustom, 0, maxRangeSeconds+1, Range24h, now)
		require.Error(t, err)
	})

	t.Run("unknown range name is rejected", func(t *testing.T) {
		_, err := resolveRange("last-century", 0, 0, Range24h, now)
		require.Error(t, err)
	})
}

func TestBucketStart(t *testing.T) {
	assert.Equal(t, int64(120), bucketStart(125, 60))
	assert.Equal(t, int64(0), bucketStart(59, 60))
	assert.Equal(t, int64(86400*2), bucketStart(86400*2+1, 86400))
	assert.Equal(t, int64(-60), bucketStart(-1, 60))
}

func TestBucketSizesBySpan(t *testing.T) {
	assert.Equal(t, int64(3600), trafficBucketSeconds(24*3600))
	assert.Equal(t, int64(86400), trafficBucketSeconds(7*24*3600))
	assert.Equal(t, int64(3600), trendBucketSeconds("hour", 24*3600))
	assert.Equal(t, int64(86400), trendBucketSeconds("hour", hourGranularityMaxSpan+1))
	assert.Equal(t, int64(86400), trendBucketSeconds("day", 24*3600))
	assert.Equal(t, int64(86400), trendBucketSeconds("", 24*3600))
}
