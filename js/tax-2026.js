/* =====================================================================
 * tax-2026.js — Biblioteca de cálculo de imposto pessoa física DK 2026
 * ---------------------------------------------------------------------
 * Regras CONFIRMADAS pelas pesquisas (skat.dk, skm.dk, borger.dk).
 *
 * Ordem oficial do cálculo:
 *   1) Salário bruto
 *   2) Deduz ATP empregado (99 kr./mês) + contribuição própria de pensão
 *   3) Aplica 8% AM-bidrag sobre o resto
 *   4) Base "personlig indkomst após AM-bidrag" alimenta:
 *        - bundskat (12,01%) com personfradrag 54.100 kr.
 *        - mellemskat (7,5%) acima de 641.200 kr.
 *        - topskat (7,5%) acima de 777.900 kr.
 *        - toptopskat (5%) acima de 2.592.700 kr.
 *        - kommuneskat + kirkeskat (também com personfradrag)
 *      menos beskæftigelsesfradrag e jobfradrag.
 *
 * Skråt skatteloft 2026 = 52,07% (com topskat) / 57,07% (com toptopskat).
 * Verificado: menores de 18 anos ISENTOS de AM-bidrag a partir de 01/01/2026.
 *
 * Exporta: window.TAX
 * ===================================================================== */
(function (global) {
  'use strict';

  // ====================================================================
  // CONSTANTES 2026 (fonte: skat.dk + Skatteministeriet)
  // ====================================================================
  const YEAR = 2026;

  // 1) AM-bidrag (Arbejdsmarkedsbidrag)
  const AM_BIDRAG_RATE = 0.08;

  // 2) Bundskat
  const BUNDSKAT_RATE = 0.1201;
  const PERSONFRADRAG_ADULT = 54100;   // kr/ano — unificado em 2026
  const PERSONFRADRAG_UNDER18 = 54100; // idem (antigo desconto eliminado)

  // 3) Mellemskat (reintroduzida pela Forårspakke 2026)
  const MELLEMSKAT_RATE = 0.075;
  const MELLEMSKAT_THRESHOLD = 641200; // kr/ano APÓS AM-bidrag

  // 4) Topskat (reduzida de 15% para 7,5% em 2026)
  const TOPSKAT_RATE = 0.075;
  const TOPSKAT_THRESHOLD = 777900;    // kr/ano APÓS AM-bidrag

  // 5) Toptopskat (NOVA em 2026, ~0,5% dos contribuintes)
  const TOPTOPSKAT_RATE = 0.05;
  const TOPTOPSKAT_THRESHOLD = 2592700; // kr/ano APÓS AM-bidrag

  // 6) Beskæftigelsesfradrag (employment allowance)
  const BESKAEFTIGELSESFRADRAG_PCT = 0.1275;
  const BESKAEFTIGELSESFRADRAG_CAP = 63300;
  const BESKAEFTIGELSESFRADRAG_FULL_AT = 496471; // bruto AM-bidrag para teto

  // 7) Jobfradrag (additional job allowance)
  const JOBFRADRAG_RATE = 0.045;
  const JOBFRADRAG_FLOOR = 235200;
  const JOBFRADRAG_CAP = 3100;

  // 10) ATP — empregado paga 99 kr./mês, antes do AM-bidrag
  const ATP_LON_MODT_MNED = 99;        // kr/mês (parte do empregado)
  const ATP_LON_MODT_AAR = 1188;       // 12 * 99

  // Skråt skatteloft 2026 — caps sobre soma de (kommune + bund + mellem + [top] + [toptop])
  // Kirkeskat NÃO entra no teto, fica por cima.
  // Fonte: Skat.dk faktaark skatteloft + Skattereformen 2026
  const TAX_CEILING_MELLEMSKAT = 0.4457;   // 44,57% — quando só bund + mellem aplicam
  const TAX_CEILING_TOPSKAT = 0.5207;      // 52,07% — quando topskat aplica
  const TAX_CEILING_TOPTOPSKAT = 0.5707;   // 57,07% — quando toptopskat aplica

  // AM-bidrag isento abaixo dessa idade a partir de 2026
  const AM_BIDRAG_EXEMPT_AGE = 18;

  // ====================================================================
  // HELPERS
  // ====================================================================
  function round2(x) { return Math.round(x * 100) / 100; }
  function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }
  function num(x, def) {
    const v = Number(x);
    return Number.isFinite(v) ? v : (def || 0);
  }

  function formatKr(x) {
    if (!Number.isFinite(x)) return '—';
    // Formato dinamarquês: "423.456 kr." (ponto = milhar)
    const n = Math.round(x);
    const s = n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return s + ' kr.';
  }

  function formatPct(x, decimals) {
    if (!Number.isFinite(x)) return '—';
    const d = decimals == null ? 2 : decimals;
    return (x * 100).toFixed(d).replace('.', ',') + ' %';
  }

  // ====================================================================
  // CÁLCULO DE FRADRAGS DEPENDENTES DE RENDA
  // ====================================================================

  // Beskæftigelsesfradrag: 12,75% da base AM-bidrag, máximo 63.300 kr.
  function calcBeskaeftigelsesfradrag(baseAmBidrag) {
    const bruto = Math.max(0, baseAmBidrag);
    const raw = bruto * BESKAEFTIGELSESFRADRAG_PCT;
    return Math.min(BESKAEFTIGELSESFRADRAG_CAP, raw);
  }

  // Jobfradrag: 4,5% do que excede 235.200 kr., máx 3.100 kr.
  function calcJobfradrag(baseAmBidrag) {
    const excedente = Math.max(0, baseAmBidrag - JOBFRADRAG_FLOOR);
    return Math.min(JOBFRADRAG_CAP, excedente * JOBFRADRAG_RATE);
  }

  // ====================================================================
  // CÁLCULO PRINCIPAL: calcNetSalary
  // ====================================================================
  /**
   * @param {Object} p
   * @param {number} p.bruttoAr            Salário bruto anual (kr.)
   * @param {Object|number} p.kommune      { kommuneskat, kirkeskat } em % ou nº kommuneskat
   * @param {boolean} p.medlemFolkekirke   true => paga kirkeskat
   * @param {number} p.pensionEgenPct      % bruto descontado pelo empregador para pensão própria (ex: 4 = 4%)
   * @param {number} p.pensionArbejdsgiverPct % bruto pago pelo empregador (afeta apenas a custo total)
   * @param {boolean} p.atp                true => paga ATP (99 kr/mês)
   * @param {number} p.alder               Idade — <18 isento de AM-bidrag em 2026
   * @param {number} p.fagforeningKr       Sindicato (fradrag ligningsmæssigt, ano)
   * @param {number} p.akasseKr            A-kasse (fradrag ligningsmæssigt, ano)
   * @param {number} p.korselsfradragKr    Kørselsfradrag já calculado (ano)
   * @param {number} p.renteUdgifterKr     Juros pagos (rendas negativas, kr/ano)
   */
  function calcNetSalary(p) {
    p = p || {};
    const bruttoAr = num(p.bruttoAr, 0);

    // ---- kommune skat (% pode vir como objeto ou número) ----
    let kommuneskatPct = 25.43; // média DK 2026
    let kirkeskatPct = 0.93;
    if (typeof p.kommune === 'number') {
      kommuneskatPct = p.kommune;
    } else if (p.kommune && typeof p.kommune === 'object') {
      kommuneskatPct = num(p.kommune.kommuneskat, kommuneskatPct);
      kirkeskatPct = num(p.kommune.kirkeskat, kirkeskatPct);
    }
    const kommuneskatRate = kommuneskatPct / 100;
    const kirkeskatRate = (p.medlemFolkekirke ? kirkeskatPct : 0) / 100;

    // ---- Passo 1: ATP empregado (kr/ano) ----
    const alder = num(p.alder, 30);
    const atpKr = (p.atp === false) ? 0 : ATP_LON_MODT_AAR;

    // ---- Passo 2: pensão própria (dedutível ANTES do AM-bidrag — bortseelsesret) ----
    const pensionEgenPct = clamp(num(p.pensionEgenPct, 0), 0, 100);
    const pensionEgen = bruttoAr * (pensionEgenPct / 100);

    // ---- Passo 3: AM-bidrag (8%) sobre bruto - ATP - pensão própria ----
    const baseAmBidrag = Math.max(0, bruttoAr - atpKr - pensionEgen);
    const isentoAmBidrag = alder < AM_BIDRAG_EXEMPT_AGE; // 2026: <18 isento
    const amBidrag = isentoAmBidrag ? 0 : baseAmBidrag * AM_BIDRAG_RATE;

    // ---- Passo 4: personlig indkomst após AM-bidrag ----
    const personligIndkomst = baseAmBidrag - amBidrag;

    // ---- Fradrags ligningsmæssige (reduzem base de kommune/bund, valor à taxa kommunal) ----
    const beskaeft = calcBeskaeftigelsesfradrag(baseAmBidrag);
    const jobfradrag = calcJobfradrag(baseAmBidrag);
    const fagforening = num(p.fagforeningKr, 0);
    const akasse = num(p.akasseKr, 0);
    const korsel = num(p.korselsfradragKr, 0);
    const renteUdg = num(p.renteUdgifterKr, 0);

    const totalLigningsfradrag = beskaeft + jobfradrag + fagforening + akasse + korsel + renteUdg;

    // ---- Personfradrag (mesmo valor 2026, independente da idade) ----
    const personfradrag = (alder < 18) ? PERSONFRADRAG_UNDER18 : PERSONFRADRAG_ADULT;

    // ---- Bundskat (12,01% sobre pers. indkomst - personfradrag, mín 0) ----
    const bundskatBase = Math.max(0, personligIndkomst - personfradrag);
    const bundskat = bundskatBase * BUNDSKAT_RATE;

    // ---- Mellemskat (7,5% sobre o que excede 641.200) ----
    const mellemskatBase = Math.max(0, personligIndkomst - MELLEMSKAT_THRESHOLD);
    const mellemskat = mellemskatBase * MELLEMSKAT_RATE;

    // ---- Topskat (7,5% sobre o que excede 777.900) ----
    const topskatBase = Math.max(0, personligIndkomst - TOPSKAT_THRESHOLD);
    const topskat = topskatBase * TOPSKAT_RATE;

    // ---- Toptopskat (5% sobre o que excede 2.592.700) ----
    const toptopskatBase = Math.max(0, personligIndkomst - TOPTOPSKAT_THRESHOLD);
    const toptopskat = toptopskatBase * TOPTOPSKAT_RATE;

    // ---- Kommuneskat + Kirkeskat ----
    // Base: personlig indkomst - ligningsmæssige fradrag - personfradrag
    const kommunalBase = Math.max(0,
      personligIndkomst - totalLigningsfradrag - personfradrag);
    const kommuneskat = kommunalBase * kommuneskatRate;
    const kirkeskat = kommunalBase * kirkeskatRate;

    // ---- Aplicar skråt skatteloft 2026 (skattenedslag) ----
    // O Skat aplica skatteloftsnedslag quando soma das alíquotas marginais
    // (kommune + bund + mellem + top + toptop, SEM kirke) excede o teto:
    //   - 44,57% se NÃO paga top nem toptopskat (só bund/mellem)
    //   - 52,07% se paga topskat (bund+mellem+top)
    //   - 57,07% se paga toptopskat (bund+mellem+top+toptop)
    // O nedslag é aplicado proporcionalmente sobre as alíquotas STATALES (top→mellem→bund)
    // pra não baixar abaixo de zero. Aqui simplificamos reduzindo do nível mais alto pra baixo.
    let topskatAjustado = topskat;
    let toptopskatAjustado = toptopskat;
    let mellemskatAjustado = mellemskat;
    let bundskatAjustado = bundskat;

    // Determina qual teto aplicar (o mais alto onde a renda chega)
    let cap = TAX_CEILING_MELLEMSKAT;
    let baseRateSum = kommuneskatRate + BUNDSKAT_RATE;
    if (mellemskatBase > 0) baseRateSum += MELLEMSKAT_RATE;
    if (topskatBase > 0) {
      cap = TAX_CEILING_TOPSKAT;
      baseRateSum += TOPSKAT_RATE;
    }
    if (toptopskatBase > 0) {
      cap = TAX_CEILING_TOPTOPSKAT;
      baseRateSum += TOPTOPSKAT_RATE;
    }
    const overshoot = baseRateSum - cap;
    if (overshoot > 0) {
      // Reduz proporcionalmente do nível mais alto pro mais baixo
      let remaining = overshoot;
      // 1. Tira de toptopskat
      if (remaining > 0 && toptopskatBase > 0) {
        const reduceRate = Math.min(remaining, TOPTOPSKAT_RATE);
        toptopskatAjustado = Math.max(0, toptopskatBase * (TOPTOPSKAT_RATE - reduceRate));
        remaining -= reduceRate;
      }
      // 2. Tira de topskat
      if (remaining > 0 && topskatBase > 0) {
        const reduceRate = Math.min(remaining, TOPSKAT_RATE);
        topskatAjustado = Math.max(0, topskatBase * (TOPSKAT_RATE - reduceRate));
        remaining -= reduceRate;
      }
      // 3. Tira de mellemskat
      if (remaining > 0 && mellemskatBase > 0) {
        const reduceRate = Math.min(remaining, MELLEMSKAT_RATE);
        mellemskatAjustado = Math.max(0, mellemskatBase * (MELLEMSKAT_RATE - reduceRate));
        remaining -= reduceRate;
      }
      // 4. Tira de bundskat (raríssimo, mas pode acontecer em kommune muito alta)
      if (remaining > 0 && bundskatBase > 0) {
        const reduceRate = Math.min(remaining, BUNDSKAT_RATE);
        bundskatAjustado = Math.max(0, bundskatBase * (BUNDSKAT_RATE - reduceRate));
      }
    }

    // ---- Total impostos diretos sobre salário ----
    const totalSkat = bundskatAjustado + mellemskatAjustado + topskatAjustado + toptopskatAjustado
                    + kommuneskat + kirkeskat;

    // ---- Líquido anual ----
    // Importante: ATP + pensão própria já saíram antes do AM-bidrag, então NÃO entram aqui
    // como dedução adicional (o empregado também não recebe esse dinheiro, é poupado).
    const netto = bruttoAr - atpKr - pensionEgen - amBidrag - totalSkat;
    const nettoMaaned = netto / 12;

    // ---- Marginal e efetivo ----
    const marginalskat = calcMarginalskat(personligIndkomst, kommuneskatRate, kirkeskatRate);
    const effektivskat = bruttoAr > 0 ? (totalSkat + amBidrag) / bruttoAr : 0;

    return {
      netto: round2(netto),
      nettoMaaned: round2(nettoMaaned),
      amBidrag: round2(amBidrag),
      kommuneskat: round2(kommuneskat),
      kirkeskat: round2(kirkeskat),
      bundskat: round2(bundskatAjustado),
      mellemskat: round2(mellemskatAjustado),
      topskat: round2(topskatAjustado),
      toptopskat: round2(toptopskatAjustado),
      skatteloftsnedslag: round2(
        (bundskat - bundskatAjustado) +
        (mellemskat - mellemskatAjustado) +
        (topskat - topskatAjustado) +
        (toptopskat - toptopskatAjustado)
      ),
      pensionEgen: round2(pensionEgen),
      atpKr: round2(atpKr),
      fradrag: {
        beskaeftigelsesfradrag: round2(beskaeft),
        jobfradrag: round2(jobfradrag),
        personfradrag: personfradrag,
        fagforening: round2(fagforening),
        akasse: round2(akasse),
        korselsfradrag: round2(korsel),
        renteUdgifter: round2(renteUdg),
        total: round2(totalLigningsfradrag + personfradrag)
      },
      marginalskat: round2(marginalskat * 10000) / 10000,
      effektivskat: round2(effektivskat * 10000) / 10000,
      breakdown: {
        bruttoAr: round2(bruttoAr),
        baseAmBidrag: round2(baseAmBidrag),
        personligIndkomst: round2(personligIndkomst),
        kommunalBase: round2(kommunalBase),
        totalSkat: round2(totalSkat),
        totalTrukket: round2(amBidrag + totalSkat + atpKr + pensionEgen)
      }
    };
  }

  // Marginal: 8% AM-bidrag + (bund + mellem? + top? + toptop?) + kommune + kirke
  // O skråt skatteloft cobre kommune+bund+mellem+top(+toptop), exclui kirkeskat.
  function calcMarginalskat(personligIndkomst, kommuneskatRate, kirkeskatRate) {
    let r = AM_BIDRAG_RATE; // primeira camada
    const factor = 1 - AM_BIDRAG_RATE; // 0,92 — uma coroa bruta vira 0,92 após AM
    let stateAndKommune = BUNDSKAT_RATE + kommuneskatRate;
    if (personligIndkomst > MELLEMSKAT_THRESHOLD) stateAndKommune += MELLEMSKAT_RATE;
    if (personligIndkomst > TOPSKAT_THRESHOLD)    stateAndKommune += TOPSKAT_RATE;
    if (personligIndkomst > TOPTOPSKAT_THRESHOLD) stateAndKommune += TOPTOPSKAT_RATE;
    // Aplica o teto (skatteloft) sobre a soma state + kommune (sem kirke)
    const loft = personligIndkomst > TOPTOPSKAT_THRESHOLD
      ? TAX_CEILING_TOPTOPSKAT
      : (personligIndkomst > TOPSKAT_THRESHOLD ? TAX_CEILING_TOPSKAT : 1.0);
    const cappedExclKirke = Math.min(stateAndKommune, loft);
    const marginalAposAm = cappedExclKirke + kirkeskatRate;
    r += factor * marginalAposAm;
    return r;
  }

  // ====================================================================
  // calcRaiseImpact — impacto líquido de aumento
  // ====================================================================
  function calcRaiseImpact(p) {
    p = p || {};
    const before = calcNetSalary(Object.assign({}, p, { bruttoAr: p.currentBruttoAr }));
    const after = calcNetSalary(Object.assign({}, p, { bruttoAr: p.currentBruttoAr + p.raiseAr }));
    const deltaNetto = after.netto - before.netto;
    const deltaSkat = (after.breakdown.totalSkat + after.amBidrag)
                   - (before.breakdown.totalSkat + before.amBidrag);
    const efetivaSobreAumento = p.raiseAr > 0 ? deltaSkat / p.raiseAr : 0;
    return {
      before, after,
      deltaBrutto: round2(p.raiseAr),
      deltaNetto: round2(deltaNetto),
      deltaSkat: round2(deltaSkat),
      pctRetido: round2(efetivaSobreAumento * 10000) / 10000,
      pctRecebido: round2((1 - efetivaSobreAumento) * 10000) / 10000
    };
  }

  // ====================================================================
  // calcBonusAfterTax — bônus, com opção de canalizar para pensão
  // ====================================================================
  function calcBonusAfterTax(p) {
    p = p || {};
    const bonus = num(p.bonusKr, 0);
    const cur = num(p.currentBruttoAr, 0);
    const intoPensao = num(p.indbetalTilPension, 0);
    const bonusReal = Math.max(0, bonus - intoPensao);

    const baseCase = calcNetSalary(Object.assign({}, p, { bruttoAr: cur }));
    const comBonus = calcNetSalary(Object.assign({}, p, { bruttoAr: cur + bonusReal }));
    const liquidoBonus = comBonus.netto - baseCase.netto;
    const skatBonus = bonusReal - liquidoBonus;
    const pctEfetiva = bonusReal > 0 ? skatBonus / bonusReal : 0;

    return {
      bonusBrutto: round2(bonus),
      paraPensao: round2(intoPensao),
      bonusTributavel: round2(bonusReal),
      liquidoNoBolso: round2(liquidoBonus),
      skatRetido: round2(skatBonus),
      pctEfetiva: round2(pctEfetiva * 10000) / 10000,
      // Se tivesse colocado tudo em pensão (bortseelsesret): 0 imposto agora
      seTudoPensao: { liquidoAgora: 0, naPensao: round2(bonus) }
    };
  }

  // ====================================================================
  // compareKommuner — roda mesmo input para várias kommuner
  // ====================================================================
  function compareKommuner(kommuner, baseInput) {
    const arr = Array.isArray(kommuner) ? kommuner : [];
    const out = arr.map(k => {
      const res = calcNetSalary(Object.assign({}, baseInput, { kommune: k }));
      return {
        navn: k.navn,
        slug: k.slug,
        kommuneskat: k.kommuneskat,
        kirkeskat: k.kirkeskat,
        netto: res.netto,
        nettoMaaned: res.nettoMaaned,
        totalSkat: res.breakdown.totalSkat,
        effektivskat: res.effektivskat
      };
    });
    out.sort((a, b) => b.netto - a.netto);
    return out;
  }

  // ====================================================================
  // calcFeriepenge — 12,5% do salário ganho no ano-base
  // ====================================================================
  function calcFeriepenge(p) {
    p = p || {};
    const bruttoAr = num(p.bruttoAr, 0);
    const pct = num(p.feriepengePct, 12.5) / 100;
    const feriepengeBrutto = bruttoAr * pct;
    // Tributado como salário normal
    const comFerie = calcNetSalary(Object.assign({}, p, { bruttoAr: bruttoAr + feriepengeBrutto }));
    const semFerie = calcNetSalary(Object.assign({}, p, { bruttoAr: bruttoAr }));
    const feriepengeNetto = comFerie.netto - semFerie.netto;
    return {
      feriepengeBrutto: round2(feriepengeBrutto),
      feriepengeNetto: round2(feriepengeNetto),
      effektivskatFerie: feriepengeBrutto > 0
        ? round2((1 - feriepengeNetto / feriepengeBrutto) * 10000) / 10000
        : 0
    };
  }

  // ====================================================================
  // calcFreelancerBindkomst — B-indkomst (sem AM-bidrag retido na fonte
  // mas paga normalmente; sem ATP; sem bortseelsesret automática)
  // ====================================================================
  function calcFreelancerBindkomst(input) {
    input = input || {};
    // Freelancer/B-indkomst paga AM-bidrag igual, mas sem ATP empregado e
    // sem pensão via empregador. Sem beskæftigelsesfradrag se for sem A-indkomst.
    // TODO: confirmar regra exata 2026 com Skat (selvstændig vs honorar).
    const cloned = Object.assign({}, input, { atp: false });
    const r = calcNetSalary(cloned);
    return Object.assign({}, r, {
      tipo: 'B-indkomst',
      nota: 'Freelancer paga AM-bidrag + skat via forskudsopgørelse, sem ATP/pensão via empregador.'
    });
  }

  // ====================================================================
  // EXPOSE API
  // ====================================================================
  const TAX = {
    // constantes
    YEAR,
    AM_BIDRAG_RATE,
    BUNDSKAT_RATE,
    MELLEMSKAT_RATE, MELLEMSKAT_THRESHOLD,
    TOPSKAT_RATE, TOPSKAT_THRESHOLD,
    TOPTOPSKAT_RATE, TOPTOPSKAT_THRESHOLD,
    PERSONFRADRAG_ADULT, PERSONFRADRAG_UNDER18,
    BESKAEFTIGELSESFRADRAG_PCT, BESKAEFTIGELSESFRADRAG_CAP,
    ATP_LON_MODT_MNED, ATP_LON_MODT_AAR,
    TAX_CEILING_TOPSKAT, TAX_CEILING_TOPTOPSKAT,
    // funções
    calcNetSalary,
    calcRaiseImpact,
    calcBonusAfterTax,
    compareKommuner,
    calcFeriepenge,
    calcFreelancerBindkomst,
    calcBeskaeftigelsesfradrag,
    calcJobfradrag,
    calcMarginalskat,
    // helpers
    formatKr,
    formatPct
  };

  global.TAX = TAX;

  // ====================================================================
  // ASSERTIONS / SANITY CHECKS (executam quando ?debug=tax na URL)
  // ====================================================================
  function runAssertions() {
    const aarhus = { kommuneskat: 24.52, kirkeskat: 0.74 };
    const errs = [];

    function assert(cond, msg) {
      if (!cond) { errs.push(msg); console.error('[TAX assertion] ' + msg); }
      else { console.log('[TAX OK] ' + msg); }
    }

    // Cenário 1: bruttoAr=400.000 em Aarhus, sem kirkeskat
    const r1 = calcNetSalary({
      bruttoAr: 400000, kommune: aarhus, medlemFolkekirke: false,
      pensionEgenPct: 0, atp: true, alder: 35
    });
    assert(r1.netto > 250000 && r1.netto < 290000,
      'cenario 400k Aarhus netto deve estar em ~250-290k, obtido ' + r1.netto);
    assert(r1.topskat === 0, 'sem topskat aos 400k (obtido ' + r1.topskat + ')');
    assert(r1.toptopskat === 0, 'sem toptopskat aos 400k');
    assert(r1.amBidrag > 30000 && r1.amBidrag < 35000,
      'AM-bidrag ~ 32k para 400k bruto, obtido ' + r1.amBidrag);

    // Cenário 2: bruttoAr=800.000 — mellemskat aparece (mas topskat ainda não,
    // pois threshold de 777.900 é APÓS AM-bidrag → exige ~846k bruto).
    const r2 = calcNetSalary({
      bruttoAr: 800000, kommune: aarhus, medlemFolkekirke: false,
      pensionEgenPct: 0, atp: true, alder: 40
    });
    assert(r2.mellemskat > 0, 'mellemskat deve aparecer em 800k (obtido ' + r2.mellemskat + ')');
    assert(r2.toptopskat === 0, 'sem toptopskat aos 800k');
    assert(r2.netto > 450000 && r2.netto < 530000,
      'netto 800k deve ficar entre 450-530k, obtido ' + r2.netto);

    // Cenário 2b: bruttoAr=900.000 — agora topskat também aparece
    const r2b = calcNetSalary({
      bruttoAr: 900000, kommune: aarhus, medlemFolkekirke: false,
      pensionEgenPct: 0, atp: true, alder: 40
    });
    assert(r2b.topskat > 0, 'topskat deve aparecer em 900k (obtido ' + r2b.topskat + ')');
    assert(r2b.mellemskat > 0, 'mellemskat ativo em 900k');

    // Cenário 3: bruttoAr=3.000.000 — toptopskat aparece
    const r3 = calcNetSalary({
      bruttoAr: 3000000, kommune: aarhus, medlemFolkekirke: false,
      pensionEgenPct: 0, atp: true, alder: 50
    });
    assert(r3.toptopskat > 0, 'toptopskat deve aparecer em 3M (obtido ' + r3.toptopskat + ')');
    assert(r3.topskat > 0, 'topskat ativo em 3M');
    assert(r3.mellemskat > 0, 'mellemskat ativo em 3M');
    // Marginal real ≈ AM 8% + 0,92 × skatteloft 57,07% ≈ 60,5% para uma coroa bruta extra.
    // (O loft 57,07% cobre state+kommune, sem AM e sem kirke.)
    assert(r3.marginalskat > 0.58 && r3.marginalskat < 0.615,
      'marginal em 3M deve ser ~ 0,605 (AM + 0,92×57,07%), obtido ' + r3.marginalskat);

    // Cenário 4: menor de 18 isento de AM-bidrag em 2026
    const r4 = calcNetSalary({
      bruttoAr: 100000, kommune: aarhus, medlemFolkekirke: false,
      pensionEgenPct: 0, atp: false, alder: 17
    });
    assert(r4.amBidrag === 0, 'menor de 18 isento de AM-bidrag em 2026');

    // Cenário 5: 18 anos pagando AM-bidrag
    const r5 = calcNetSalary({
      bruttoAr: 100000, kommune: aarhus, medlemFolkekirke: false,
      pensionEgenPct: 0, atp: true, alder: 18
    });
    assert(r5.amBidrag > 0, 'aos 18 paga AM-bidrag');

    // Cenário 6: aumento de 10k para alguém na faixa de topskat retém ~52%
    const r6 = calcRaiseImpact({
      currentBruttoAr: 900000, raiseAr: 10000,
      kommune: aarhus, medlemFolkekirke: false,
      pensionEgenPct: 0, atp: true, alder: 40
    });
    assert(r6.pctRetido > 0.45 && r6.pctRetido < 0.56,
      'aumento na faixa topskat retém ~50-55%, obtido ' + r6.pctRetido);

    // Cenário 7: bonus de 50k canalizado para pensão = 0 imposto agora
    const r7 = calcBonusAfterTax({
      bonusKr: 50000, currentBruttoAr: 500000, indbetalTilPension: 50000,
      kommune: aarhus, medlemFolkekirke: false, atp: true, alder: 35
    });
    assert(r7.liquidoNoBolso === 0, 'bonus 100% pensão = 0 no bolso');

    return { ok: errs.length === 0, errors: errs };
  }

  TAX._runAssertions = runAssertions;

  if (typeof window !== 'undefined' && window.location && /[?&]debug=tax/.test(window.location.search)) {
    try { runAssertions(); } catch (e) { console.error('Assertion run failed', e); }
  }

})(typeof window !== 'undefined' ? window : globalThis);
