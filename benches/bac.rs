use criterion::{black_box, criterion_group, criterion_main, BenchmarkId, Criterion, Throughput};
use ethanol_rs::bac::{
    calculate_bac, generate_curve, minutes_until_sober, snapshot, trajectory, Drink, UserProfile,
};
use ethanol_rs::types::{BACFormula, BiologicalSex, StomachState};

fn profile() -> UserProfile {
    UserProfile {
        weight_kg: 80.0,
        biological_sex: BiologicalSex::Male,
        height_cm: 180.0,
        age: 30,
    }
}

/// Build `n` drinks spread across the last `span_secs` seconds.
fn drinks_over(n: usize, span_secs: f64) -> Vec<Drink> {
    (0..n)
        .map(|i| {
            let t = if n <= 1 {
                0.0
            } else {
                -(span_secs * (i as f64) / ((n - 1) as f64))
            };
            Drink {
                volume_ml: 330.0,
                abv: 0.05,
                offset_secs: t,
                stomach_state: StomachState::Empty,
            }
        })
        .collect()
}

fn bench_calculate_bac(c: &mut Criterion) {
    let profile = profile();
    let mut group = c.benchmark_group("calculate_bac");
    for n in [1usize, 5, 10, 25, 50, 100, 200] {
        // 4-hour active session
        let drinks = drinks_over(n, 4.0 * 3600.0);
        group.throughput(Throughput::Elements(n as u64));
        group.bench_with_input(BenchmarkId::from_parameter(n), &drinks, |b, d| {
            b.iter(|| calculate_bac(black_box(d), black_box(&profile), BACFormula::Widmark));
        });
    }
    group.finish();
}

fn bench_generate_curve(c: &mut Criterion) {
    let profile = profile();
    let mut group = c.benchmark_group("generate_curve");
    group.sample_size(30);

    // 6-hour curve at 1-minute resolution = 361 points.
    // This is the scenario the web app hits.
    let from = -3.0 * 3600.0;
    let to = 3.0 * 3600.0;
    let step = 60.0;

    for n in [1usize, 5, 10, 25, 50, 100, 200] {
        let drinks = drinks_over(n, 4.0 * 3600.0);
        group.throughput(Throughput::Elements(n as u64));
        group.bench_with_input(BenchmarkId::from_parameter(n), &drinks, |b, d| {
            b.iter(|| {
                generate_curve(
                    black_box(d),
                    black_box(&profile),
                    BACFormula::Widmark,
                    from,
                    to,
                    step,
                    0.06,
                    0.09,
                )
            });
        });
    }
    group.finish();
}

fn bench_generate_curve_resolution(c: &mut Criterion) {
    let profile = profile();
    let drinks = drinks_over(20, 4.0 * 3600.0);
    let mut group = c.benchmark_group("generate_curve_step_secs");
    group.sample_size(30);
    // 6-hour window, varying step size
    for step in [300.0f64, 120.0, 60.0, 30.0, 10.0] {
        group.bench_with_input(
            BenchmarkId::from_parameter(step as u64),
            &step,
            |b, &step| {
                b.iter(|| {
                    generate_curve(
                        black_box(&drinks),
                        black_box(&profile),
                        BACFormula::Widmark,
                        -3.0 * 3600.0,
                        3.0 * 3600.0,
                        step,
                        0.06,
                        0.09,
                    )
                });
            },
        );
    }
    group.finish();
}

fn bench_snapshot(c: &mut Criterion) {
    let profile = profile();
    let drinks = drinks_over(20, 4.0 * 3600.0);
    c.bench_function("snapshot/20_drinks", |b| {
        b.iter(|| {
            snapshot(
                black_box(&drinks),
                black_box(&profile),
                BACFormula::Widmark,
                0.06,
                0.09,
            )
        });
    });
}

fn bench_trajectory(c: &mut Criterion) {
    let profile = profile();
    let drinks = drinks_over(20, 4.0 * 3600.0);
    c.bench_function("trajectory/20_drinks", |b| {
        b.iter(|| trajectory(black_box(&drinks), black_box(&profile), BACFormula::Widmark));
    });
}

fn bench_minutes_until_sober(c: &mut Criterion) {
    let profile = profile();
    let drinks = drinks_over(20, 4.0 * 3600.0);
    let mut group = c.benchmark_group("minutes_until_sober");
    group.sample_size(20);
    group.bench_function("20_drinks", |b| {
        b.iter(|| {
            minutes_until_sober(black_box(&drinks), black_box(&profile), BACFormula::Widmark)
        });
    });
    group.finish();
}

criterion_group!(
    benches,
    bench_calculate_bac,
    bench_generate_curve,
    bench_generate_curve_resolution,
    bench_snapshot,
    bench_trajectory,
    bench_minutes_until_sober,
);
criterion_main!(benches);
