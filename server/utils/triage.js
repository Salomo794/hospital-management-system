// ---------------------------------------------------------------------------
// Clinical triage engine (rule-based)
//
// Converts free-text complaints/diagnoses into a numeric urgency score and a
// standard triage category. Used by the admissions module to power a live
// severity-ranked triage queue plus automated re-sorting of waiting patients.
//
//   critical - immediate resuscitation / ICU level
//   high     - urgent, doctor review within minutes
//   moderate - semi-urgent, review within the hour
//   low      - routine
// ---------------------------------------------------------------------------

const KEYWORDS = [
  // Critical (score contribution heavily weighted)
  { level: 'critical', score: 45, words: ['cardiac arrest', 'respiratory arrest', 'unconscious', 'unresponsive', 'seizure', 'stroke', 'anaphylaxis', 'hemorrhage', 'haemorrhage', 'severe bleeding', 'overdose', 'ventilated', 'intubated', 'status epilepticus'] },
  // High urgency clinical cues
  { level: 'high', score: 22, words: ['chest pain', 'shortness of breath', 'breathing difficulty', 'difficulty breathing', 'palpitations', 'dizziness', 'head injury', 'fracture', 'fever >', 'high fever', 'severe headache', 'blood pressure 190', 'hypertensive crisis', 'stroke-like', 'weakness on one side', 'slurred speech', 'afib', 'atrial fibrillation', 'congestive heart failure', 'heart failure', 'copd', 'acute asthma', 'severe allergic'] },
  // Moderate urgency
  { level: 'moderate', score: 10, words: ['wheezing', 'asthma', 'pneumonia', 'infection', 'dehydration', 'vomiting', 'diarrhea', 'abdominal pain', 'burn', 'wound', 'mild fever', 'fever', 'cough', 'sore throat', 'migraine', 'kidney stone', 'uti', 'low blood sugar', 'hypoglycemia'] },
  // Routine presentations
  { level: 'low', score: 4, words: ['checkup', 'follow-up', 'follow up', 'routine', 'review', 'medication review', 'refill', 'screening', 'blood work', 'results review', 'pre-operative', 'preoperative'] },
];

function classifyTriage(chiefComplaint = '', diagnosis = '', forcedSeverity = null) {
  const text = [chiefComplaint, diagnosis].join(' ').toLowerCase();
  let score = 0;
  let found = [];

  for (const bucket of KEYWORDS) {
    for (const word of bucket.words) {
      if (text.includes(word)) {
        score += bucket.score;
        found.push(word);
      }
    }
  }

  // A few clearly critical symptoms push the score past the 85 threshold
  // regardless of other context.
  const hasCritical = KEYWORDS[0].words.some(w => text.includes(w));
  if (hasCritical) score = Math.max(score, 85);
  if (!text.trim()) score = 25;

  const severity = forcedSeverity || (score >= 65 ? 'critical' : score >= 35 ? 'high' : score >= 15 ? 'moderate' : 'low');

  // Keep the numeric score consistent with the assigned severity bucket so the
  // triage queue always ranks critical above high above moderate above low.
  const bucketFloor = { critical: 65, high: 35, moderate: 15, low: 0 };
  if (score < bucketFloor[severity]) score = bucketFloor[severity];

  return { triageScore: Math.min(100, Math.max(0, score)), triageSeverity: severity, matched: [...new Set(found)] };
}

module.exports = { classifyTriage };