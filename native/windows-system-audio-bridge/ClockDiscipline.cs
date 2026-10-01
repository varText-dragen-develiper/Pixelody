using System.Diagnostics;

sealed record EndpointClockModelSnapshot(
    int sampleCount,
    double nominalFramesPerSecond,
    double observedFramesPerSecond,
    double driftPpm,
    ulong latestDeviceFrames,
    ulong latestQpcPosition);

sealed class EndpointClockModel
{
    const int MaximumSamples = 96;
    readonly Queue<(ulong deviceFrames, ulong qpcPosition)> samples = new();
    readonly double nominalFramesPerSecond;

    public EndpointClockModel(uint sampleRate) => nominalFramesPerSecond = sampleRate;

    public void Add(ulong deviceFrames, ulong qpcPosition)
    {
        if (samples.Count > 0 && (deviceFrames <= samples.Last().deviceFrames || qpcPosition <= samples.Last().qpcPosition)) return;
        samples.Enqueue((deviceFrames, qpcPosition));
        while (samples.Count > MaximumSamples) samples.Dequeue();
    }

    public EndpointClockModelSnapshot Snapshot()
    {
        (ulong deviceFrames, ulong qpcPosition) latest = samples.Count == 0 ? (0UL, 0UL) : samples.Last();
        if (samples.Count < 2)
        {
            return new EndpointClockModelSnapshot(samples.Count, nominalFramesPerSecond, 0, 0, latest.deviceFrames, latest.qpcPosition);
        }

        var first = samples.First();
        var last = samples.Last();
        var qpcSeconds = (last.qpcPosition - first.qpcPosition) / (double)Stopwatch.Frequency;
        var observedFramesPerSecond = qpcSeconds > 0
            ? (last.deviceFrames - first.deviceFrames) / qpcSeconds
            : 0;
        var driftPpm = observedFramesPerSecond > 0
            ? ((observedFramesPerSecond - nominalFramesPerSecond) / nominalFramesPerSecond) * 1_000_000d
            : 0;
        return new EndpointClockModelSnapshot(samples.Count, nominalFramesPerSecond, observedFramesPerSecond, driftPpm, latest.deviceFrames, latest.qpcPosition);
    }
}

sealed record FollowerClockCorrection(
    double ratio,
    double correctionPpm,
    double requestedPpm,
    int bufferErrorFrames,
    bool clamped,
    string state);

sealed class FollowerClockDiscipline
{
    public const double MaximumCorrectionPpm = 300d;
    public const double MaximumSlewPpmPerUpdate = 20d;
    public const double MinimumRatio = 1d - MaximumCorrectionPpm / 1_000_000d;
    public const double MaximumRatio = 1d + MaximumCorrectionPpm / 1_000_000d;

    double appliedPpm;

    public FollowerClockCorrection Update(EndpointClockModelSnapshot leader, EndpointClockModelSnapshot follower, int bufferErrorFrames, int targetBufferFrames)
    {
        if (leader.sampleCount < 2 || follower.sampleCount < 2 || leader.observedFramesPerSecond <= 0 || follower.observedFramesPerSecond <= 0)
        {
            return new FollowerClockCorrection(1, 0, 0, bufferErrorFrames, false, "warming-up");
        }

        // Positive follower drift means its endpoint consumes frames faster than the leader timeline.
        var clockPpm = leader.driftPpm - follower.driftPpm;
        var bufferPpm = targetBufferFrames > 0
            ? Math.Clamp(-bufferErrorFrames / (double)targetBufferFrames * 80d, -80d, 80d)
            : 0d;
        var requestedPpm = clockPpm + bufferPpm;
        var boundedRequest = Math.Clamp(requestedPpm, -MaximumCorrectionPpm, MaximumCorrectionPpm);
        var nextPpm = Math.Clamp(boundedRequest, appliedPpm - MaximumSlewPpmPerUpdate, appliedPpm + MaximumSlewPpmPerUpdate);
        appliedPpm = nextPpm;
        var ratio = Math.Clamp(1d + nextPpm / 1_000_000d, MinimumRatio, MaximumRatio);
        return new FollowerClockCorrection(
            ratio,
            nextPpm,
            requestedPpm,
            bufferErrorFrames,
            Math.Abs(requestedPpm) > MaximumCorrectionPpm || Math.Abs(nextPpm - boundedRequest) > 0.001d,
            Math.Abs(nextPpm) < 0.5d ? "stable" : "correcting");
    }
}

// This is intentionally PCM-only. Endpoint opening, decode, and format conversion remain bridge responsibilities.
sealed record AsyncResamplerResult(int outputFramesProduced, int inputFramesConsumed, double remainingSourceFrame);

sealed class BoundedAsyncResampler
{
    double sourceFramePosition;

    public AsyncResamplerResult Process(float[] input, int inputFrames, float[] output, int outputFrames, int channels, double sourceFramesPerOutputFrame)
    {
        if (channels <= 0 || inputFrames < 2 || outputFrames <= 0 || input.Length < inputFrames * channels || output.Length < outputFrames * channels)
        {
            return new AsyncResamplerResult(0, 0, sourceFramePosition);
        }
        var ratio = Math.Clamp(sourceFramesPerOutputFrame, FollowerClockDiscipline.MinimumRatio, FollowerClockDiscipline.MaximumRatio);
        var produced = 0;
        while (produced < outputFrames && sourceFramePosition + 1d < inputFrames)
        {
            var sourceFrame = (int)sourceFramePosition;
            var fraction = (float)(sourceFramePosition - sourceFrame);
            for (var channel = 0; channel < channels; channel++)
            {
                var first = input[sourceFrame * channels + channel];
                var second = input[(sourceFrame + 1) * channels + channel];
                output[produced * channels + channel] = first + (second - first) * fraction;
            }
            produced++;
            sourceFramePosition += ratio;
        }
        var consumed = (int)sourceFramePosition;
        sourceFramePosition -= consumed;
        return new AsyncResamplerResult(produced, consumed, sourceFramePosition);
    }
}

sealed record ClockDisciplineSelfTestResult(bool passed, EndpointClockModelSnapshot leader, EndpointClockModelSnapshot follower, FollowerClockCorrection correction, bool bounded, bool slewBounded, int resamplerFrames, int resamplerInputFramesConsumed);

static class ClockDisciplineSelfTest
{
    public static ClockDisciplineSelfTestResult Run()
    {
        var leader = new EndpointClockModel(48000);
        var follower = new EndpointClockModel(48000);
        for (ulong index = 0; index < 8; index++)
        {
            var qpc = index * (ulong)(Stopwatch.Frequency / 10);
            leader.Add(index * 4800, qpc);
            follower.Add((ulong)Math.Round(index * 4800.72d), qpc);
        }
        var correction = new FollowerClockDiscipline();
        var first = correction.Update(leader.Snapshot(), follower.Snapshot(), 0, 480);
        var second = correction.Update(leader.Snapshot(), follower.Snapshot(), 0, 480);
        var resampler = new BoundedAsyncResampler();
        var input = new float[] { 0, 0, 1, 1, 0, 0, -1, -1 };
        var output = new float[8];
        var result = resampler.Process(input, 4, output, 4, 2, second.ratio);
        var bounded = second.ratio >= FollowerClockDiscipline.MinimumRatio && second.ratio <= FollowerClockDiscipline.MaximumRatio;
        var slewBounded = Math.Abs(second.correctionPpm - first.correctionPpm) <= FollowerClockDiscipline.MaximumSlewPpmPerUpdate + 0.001d;
        var passed = bounded && slewBounded && result.outputFramesProduced > 0 && result.inputFramesConsumed > 0;
        return new ClockDisciplineSelfTestResult(passed, leader.Snapshot(), follower.Snapshot(), second, bounded, slewBounded, result.outputFramesProduced, result.inputFramesConsumed);
    }
}
