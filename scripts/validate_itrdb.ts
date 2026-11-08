import fs from 'fs';
import { loadEnvironmentDataset } from '../src/services/environmentApi';
import { simulateTreeCrossSection } from '../src/model/growthEngine';
import { SpeciesId } from '../src/model/types';

interface SiteDef {
  code: string;
  name: string;
  species: SpeciesId;
  lat: number;
  lon: number;
  elev: number;
  minYear: number;
  maxYear: number;
}

const SITES: SiteDef[] = [
  // Ponderosa Pine Sites
  {
    code: 'az575',
    name: 'Fort Valley (Flagstaff, AZ)',
    species: 'ponderosa-pine',
    lat: 35.267,
    lon: -111.75,
    elev: 2260,
    minYear: 1850,
    maxYear: 2008,
  },
  {
    code: 'az592',
    name: 'Walnut Canyon (Flagstaff, AZ)',
    species: 'ponderosa-pine',
    lat: 35.167,
    lon: -111.517,
    elev: 1995,
    minYear: 1850,
    maxYear: 2010,
  },
  {
    code: 'az572',
    name: 'Flagstaff Mod+Arch (AZ)',
    species: 'ponderosa-pine',
    lat: 35.4,
    lon: -111.583,
    elev: 2185,
    minYear: 1850,
    maxYear: 1987,
  },
  {
    code: 'co596',
    name: 'Crags Hotel / Boulder (CO)',
    species: 'ponderosa-pine',
    lat: 39.933,
    lon: -105.3,
    elev: 2002,
    minYear: 1850,
    maxYear: 2003,
  },
  {
    code: 'or085',
    name: 'Mill Creek RNA (Ochoco, OR)',
    species: 'ponderosa-pine',
    lat: 44.5,
    lon: -120.867,
    elev: 1002,
    minYear: 1850,
    maxYear: 1999,
  },

  // Douglas-fir Sites
  {
    code: 'az591',
    name: 'Walnut Canyon (Flagstaff, AZ)',
    species: 'douglas-fir',
    lat: 35.167,
    lon: -111.517,
    elev: 1995,
    minYear: 1850,
    maxYear: 2010,
  },
  {
    code: 'az568',
    name: 'Black River (White Mts, AZ)',
    species: 'douglas-fir',
    lat: 33.75,
    lon: -109.417,
    elev: 2434,
    minYear: 1850,
    maxYear: 2008,
  },
  {
    code: 'co603',
    name: 'Eldorado Canyon (Boulder, CO)',
    species: 'douglas-fir',
    lat: 39.933,
    lon: -105.3,
    elev: 2002,
    minYear: 1850,
    maxYear: 2003,
  },
  {
    code: 'mt110',
    name: 'North Fork Ridge (MT)',
    species: 'douglas-fir',
    lat: 45.3,
    lon: -111.333,
    elev: 2500,
    minYear: 1850,
    maxYear: 2000,
  },
  {
    code: 'or026',
    name: 'Abbot Creek RNA (Cascades, OR)',
    species: 'douglas-fir',
    lat: 42.933,
    lon: -122.533,
    elev: 1448,
    minYear: 1850,
    maxYear: 1981,
  },
  {
    code: 'wa091',
    name: 'Tahoma Creek (Mt Rainier, WA)',
    species: 'douglas-fir',
    lat: 46.767,
    lon: -121.9,
    elev: 970,
    minYear: 1850,
    maxYear: 1987,
  },
];

// Load parsed ITRDB data
const parsedItrdbPath =
  'C:/Users/Steve/.gemini/antigravity/brain/ea1d6c52-cdbc-4175-a8d6-f205a14b4d94/scratch/parsed_itrdb_clean.json';
const rawItrdbData = JSON.parse(fs.readFileSync(parsedItrdbPath, 'utf-8'));

function computeStats(x: number[], y: number[]) {
  const n = x.length;
  if (n < 4) return { r: 0, pVal: 1, ce: -99, re: -99, r1X: 0, r1Y: 0, msX: 0, msY: 0, meanX: 0, meanY: 0, stdX: 0, stdY: 0 };

  const meanX = x.reduce((a, b) => a + b, 0) / n;
  const meanY = y.reduce((a, b) => a + b, 0) / n;

  let cov = 0;
  let varX = 0;
  let varY = 0;
  let sse = 0;

  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    cov += dx * dy;
    varX += dx * dx;
    varY += dy * dy;
    sse += (y[i] - x[i]) * (y[i] - x[i]);
  }

  const r = varX > 0 && varY > 0 ? cov / Math.sqrt(varX * varY) : 0;
  const t = Math.abs(r) * Math.sqrt((n - 2) / Math.max(0.0001, 1 - r * r));
  const pVal = 2 * (1 - normalCdf(t));

  const ce = 1 - sse / Math.max(0.0001, varY);

  const r1X = computeR1(x, meanX);
  const r1Y = computeR1(y, meanY);

  const msX = computeMeanSensitivity(x);
  const msY = computeMeanSensitivity(y);

  return { r, pVal, ce, r1X, r1Y, msX, msY, meanX, meanY, stdX: Math.sqrt(varX / n), stdY: Math.sqrt(varY / n) };
}

function computeR1(arr: number[], mean: number): number {
  if (arr.length < 3) return 0;
  let num = 0;
  let den = 0;
  for (let i = 0; i < arr.length - 1; i++) {
    num += (arr[i] - mean) * (arr[i + 1] - mean);
  }
  for (let i = 0; i < arr.length; i++) {
    den += (arr[i] - mean) * (arr[i] - mean);
  }
  return den > 0 ? num / den : 0;
}

function computeMeanSensitivity(arr: number[]): number {
  if (arr.length < 2) return 0;
  let sum = 0;
  for (let i = 0; i < arr.length - 1; i++) {
    const denom = arr[i] + arr[i + 1];
    if (denom > 0) {
      sum += (2 * Math.abs(arr[i + 1] - arr[i])) / denom;
    }
  }
  return sum / (arr.length - 1);
}

function normalCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}

async function runValidation() {
  console.log('================================================================================');
  console.log('  DENDROSIM FORWARD MODEL VALIDATION AGAINST ITRDB CHRONOLOGIES');
  console.log('================================================================================\n');

  const summaryResults: any[] = [];

  for (const site of SITES) {
    console.log(`\nEvaluating [${site.code.toUpperCase()}] ${site.name} (${site.species})...`);
    const empiricalSeries = rawItrdbData[site.code]?.series || {};

    const startYear = Math.max(1880, site.minYear);
    const endYear = site.maxYear;
    const simYears = endYear - startYear + 1;

    const env = await loadEnvironmentDataset(site.lat, site.lon, startYear, endYear);

    const sim = simulateTreeCrossSection(
      {
        species: site.species,
        latitude: site.lat,
        longitude: site.lon,
        totalAge: simYears + 5,
        deathYear: endYear,
        unitSystem: 'metric',
      },
      env
    );

    const simByYear = new Map<number, number>();
    for (const r of sim.rings) {
      simByYear.set(r.record.calendarYear, r.record.climateIndex);
    }

    const pairsAll: { yr: number; sim: number; obs: number }[] = [];
    const pairsNasa: { yr: number; sim: number; obs: number }[] = [];
    const pairsPre: { yr: number; sim: number; obs: number }[] = [];

    for (let yr = startYear; yr <= endYear; yr++) {
      const obsVal = empiricalSeries[String(yr)]?.rwi;
      const simVal = simByYear.get(yr);
      if (obsVal !== undefined && simVal !== undefined) {
        pairsAll.push({ yr, sim: simVal, obs: obsVal });
        if (yr >= 1981) {
          pairsNasa.push({ yr, sim: simVal, obs: obsVal });
        } else {
          pairsPre.push({ yr, sim: simVal, obs: obsVal });
        }
      }
    }

    const statsNasa = computeStats(
      pairsNasa.map((p) => p.sim),
      pairsNasa.map((p) => p.obs)
    );

    const statsPre = computeStats(
      pairsPre.map((p) => p.sim),
      pairsPre.map((p) => p.obs)
    );

    const statsAll = computeStats(
      pairsAll.map((p) => p.sim),
      pairsAll.map((p) => p.obs)
    );

    console.log(`  Results for ${site.code.toUpperCase()}:`);
    console.log(`    NASA POWER Period (1981-${endYear}, n=${pairsNasa.length}):`);
    if (pairsNasa.length >= 4) {
      console.log(`      Correlation r = ${statsNasa.r.toFixed(3)} (p = ${statsNasa.pVal < 0.001 ? '<0.001' : statsNasa.pVal.toFixed(4)})`);
      console.log(`      Reduction of Error CE = ${statsNasa.ce.toFixed(3)}`);
      console.log(`      Autocorrelation r1: sim=${statsNasa.r1X.toFixed(2)}, obs=${statsNasa.r1Y.toFixed(2)}`);
      console.log(`      Mean Sensitivity: sim=${statsNasa.msX.toFixed(2)}, obs=${statsNasa.msY.toFixed(2)}`);
    } else {
      console.log(`      (Chronology ends in ${endYear} before or shortly after 1981)`);
    }
    console.log(`    Pre-1981 Synthetic Period (${startYear}-1980, n=${pairsPre.length}):`);
    console.log(`      Correlation r = ${statsPre.r.toFixed(3)} (p = ${statsPre.pVal.toFixed(4)})`);

    const markerCheck: Record<number, { sim: number; obs: number }> = {};
    for (const yr of [2002, 1996, 1989, 1988, 1977, 1956, 1934]) {
      const p = pairsAll.find((x) => x.yr === yr);
      if (p) {
        markerCheck[yr] = { sim: p.sim, obs: p.obs };
      }
    }

    summaryResults.push({
      site,
      nNasa: pairsNasa.length,
      nPre: pairsPre.length,
      nAll: pairsAll.length,
      statsNasa,
      statsPre,
      statsAll,
      markerCheck,
      series: pairsNasa,
    });
  }

  const outSummaryPath =
    'C:/Users/Steve/.gemini/antigravity/brain/ea1d6c52-cdbc-4175-a8d6-f205a14b4d94/scratch/itrdb_validation_results.json';
  fs.writeFileSync(outSummaryPath, JSON.stringify(summaryResults, null, 2));
  console.log(`\nValidation complete. Full results written to ${outSummaryPath}`);
}

runValidation().catch((err) => {
  console.error('Fatal error during validation:', err);
  process.exit(1);
});
