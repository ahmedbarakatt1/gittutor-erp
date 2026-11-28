import tariff from '../../../contracts/runtime/public-tuition.json';

export const tuition = tariff;
export const individualTuition = tariff.tiers.find(tier => tier.format === 'individual')!;
export const groupTuition = tariff.tiers.filter(tier => tier.students > 1);
export const sessionLength = `${tariff.duration_minutes_min}–${tariff.duration_minutes_max} minutes`;
