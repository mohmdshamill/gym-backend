import PDFDocument from 'pdfkit';

export type PlanType = 'WEIGHT_GAIN' | 'WEIGHT_LOSS' | 'RECOMPOSITION';

export interface UserMetrics {
  name: string;
  email: string;
  heightCm?: number | null;
  weightKg?: number | null;
}

export interface MetricAnalysis {
  type: PlanType;
  bmi: number | null;
  bmiCategory: string;
  idealWeightRange: { min: number; max: number } | null;
  bmr: number | null;
  tdee: number | null;
  targetCalories: number | null;
  targetProteinGrams: number | null;
  targetCarbsGrams: number | null;
  targetFatsGrams: number | null;
  targetWaterLiters: number | null;
}

export interface GeneratedPlan {
  type: PlanType;
  bmi?: number;
  bmiCategory?: string;
  analysis: MetricAnalysis;
  recommendations: string[];
  workoutsByDay: { day: number; week: number; focus: string; details: string[] }[];
  pdfBuffer: Buffer;
}

const round = (n: number, d = 1): number => {
  const factor = Math.pow(10, d);
  return Math.round(n * factor) / factor;
};

/**
 * Analyzes user height and weight metrics to determine BMI, Category, TDEE, and Plan Type
 */
export function analyzeUserMetrics(heightCm?: number | null, weightKg?: number | null): MetricAnalysis {
  if (!heightCm || !weightKg || heightCm <= 0 || weightKg <= 0) {
    return {
      type: 'RECOMPOSITION',
      bmi: null,
      bmiCategory: 'Standard Assessment',
      idealWeightRange: null,
      bmr: null,
      tdee: null,
      targetCalories: null,
      targetProteinGrams: null,
      targetCarbsGrams: null,
      targetFatsGrams: null,
      targetWaterLiters: null,
    };
  }

  const heightM = heightCm / 100;
  const bmi = round(weightKg / (heightM * heightM), 1);

  let type: PlanType = 'RECOMPOSITION';
  let bmiCategory = 'Normal Weight';

  if (bmi < 18.5) {
    type = 'WEIGHT_GAIN';
    bmiCategory = 'Underweight (Caloric Surplus Required)';
  } else if (bmi >= 18.5 && bmi < 25.0) {
    type = 'RECOMPOSITION';
    bmiCategory = 'Normal / Healthy Weight (Body Recomposition)';
  } else if (bmi >= 25.0 && bmi < 30.0) {
    type = 'WEIGHT_LOSS';
    bmiCategory = 'Overweight (Fat Loss & Conditioning)';
  } else {
    type = 'WEIGHT_LOSS';
    bmiCategory = 'Obese (Structured Fat Loss & Cardio Support)';
  }

  // Ideal weight range based on BMI 18.5 - 24.9
  const idealMin = round(18.5 * (heightM * heightM), 1);
  const idealMax = round(24.9 * (heightM * heightM), 1);

  // Mifflin-St Jeor estimated BMR calculation (standard baseline)
  const bmr = Math.round(10 * weightKg + 6.25 * heightCm - 5 * 26 + 5);
  // Estimated TDEE with moderate gym activity factor 1.45
  const tdee = Math.round(bmr * 1.45);

  let targetCalories = tdee;
  let proteinMultiplier = 2.0;

  if (type === 'WEIGHT_GAIN') {
    targetCalories = tdee + 400; // +400 kcal surplus
    proteinMultiplier = 2.0;
  } else if (type === 'WEIGHT_LOSS') {
    targetCalories = Math.max(1300, tdee - 500); // -500 kcal deficit
    proteinMultiplier = 2.2; // higher protein to preserve lean muscle in deficit
  } else {
    targetCalories = tdee;
    proteinMultiplier = 2.0;
  }

  const targetProteinGrams = Math.round(weightKg * proteinMultiplier);
  const targetFatsGrams = Math.round((targetCalories * 0.25) / 9);
  const targetCarbsGrams = Math.round((targetCalories - (targetProteinGrams * 4 + targetFatsGrams * 9)) / 4);
  const targetWaterLiters = round(weightKg * 0.035, 1);

  return {
    type,
    bmi,
    bmiCategory,
    idealWeightRange: { min: idealMin, max: idealMax },
    bmr,
    tdee,
    targetCalories,
    targetProteinGrams,
    targetCarbsGrams,
    targetFatsGrams,
    targetWaterLiters,
  };
}

export function decidePlanType(heightCm?: number | null, weightKg?: number | null): { type: PlanType; bmi?: number } {
  const analysis = analyzeUserMetrics(heightCm, weightKg);
  return {
    type: analysis.type,
    bmi: analysis.bmi ?? undefined,
  };
}

function buildRecommendations(analysis: MetricAnalysis, user: UserMetrics): string[] {
  const { type, targetCalories, targetProteinGrams, targetCarbsGrams, targetFatsGrams, targetWaterLiters, idealWeightRange } = analysis;

  const recs: string[] = [];

  if (targetCalories && targetProteinGrams) {
    recs.push(`Target Daily Calories: ~${targetCalories} kcal/day (${type === 'WEIGHT_GAIN' ? 'Calorie Surplus +400' : type === 'WEIGHT_LOSS' ? 'Calorie Deficit -500' : 'Maintenance / Recomposition'})`);
    recs.push(`Macronutrient Targets: Protein: ${targetProteinGrams}g/day | Carbs: ${targetCarbsGrams}g/day | Healthy Fats: ${targetFatsGrams}g/day`);
  } else {
    recs.push(type === 'WEIGHT_GAIN' ? 'Calorie surplus: +300 to +500 kcal/day' : type === 'WEIGHT_LOSS' ? 'Calorie deficit: -300 to -500 kcal/day' : 'Balanced maintenance caloric intake');
    recs.push('Protein intake: 1.8g - 2.2g per kg bodyweight daily');
  }

  if (targetWaterLiters) {
    recs.push(`Hydration: Minimum ${targetWaterLiters} Liters of water daily`);
  } else {
    recs.push('Hydration: 3.0 to 3.5 Liters of water daily');
  }

  if (idealWeightRange) {
    recs.push(`Healthy Target Weight Range for ${user.heightCm}cm: ${idealWeightRange.min} kg – ${idealWeightRange.max} kg`);
  }

  switch (type) {
    case 'WEIGHT_GAIN':
      recs.push('Training Focus: Progressive overload on heavy compound lifts (Bench, Squat, Deadlift, Overhead Press)');
      recs.push('Nutrition: Prioritize nutrient-dense calorie sources (oats, peanut butter, whole eggs, nuts, lean meats, rice)');
      recs.push('Recovery: 8 hours of sleep per night to maximize muscle synthesis and hormonal recovery');
      break;
    case 'WEIGHT_LOSS':
      recs.push('Training Focus: 4x weekly resistance training combined with 25–35 min post-workout cardio or brisk walking');
      recs.push('Activity: Aim for 8,000 to 10,000 daily steps to maintain high daily energy expenditure');
      recs.push('Nutrition: High dietary fiber (vegetables, greens, berries) to maximize satiety during caloric deficit');
      break;
    case 'RECOMPOSITION':
    default:
      recs.push('Training Focus: Hypertrophy-focused training (8–12 rep range) with controlled eccentric movement');
      recs.push('Nutrition: Consistent protein distribution across 4–5 balanced meals throughout the day');
      recs.push('Tracking: Monitor waist circumference and strength numbers weekly rather than just scale weight');
      break;
  }

  return recs;
}

function generateWorkoutSplit(type: PlanType): { day: number; week: number; focus: string; details: string[] }[] {
  const weeklySplit = [
    {
      focus: 'Day 1: Upper Body Strength & Power',
      details: [
        'Barbell Bench Press: 4 sets x 6–8 reps (2 min rest)',
        'Barbell Bent-Over Row: 4 sets x 6–8 reps',
        'Standing Overhead Press: 3 sets x 8–10 reps',
        'Lat Pulldown / Pull-ups: 3 sets x 10–12 reps',
        'Hanging Leg Raises: 3 sets x 12–15 reps',
      ],
    },
    {
      focus: 'Day 2: Lower Body Strength & Core',
      details: [
        'Barbell Back / Front Squat: 4 sets x 6–8 reps (2.5 min rest)',
        'Romanian Deadlift (RDL): 4 sets x 8–10 reps',
        'Leg Press: 3 sets x 10–12 reps',
        'Standing Calf Raises: 4 sets x 12–15 reps',
        'Plank Hold: 3 sets x 45–60 seconds',
      ],
    },
    {
      focus: 'Day 3: Cardiovascular Conditioning & Core Active Recovery',
      details: [
        type === 'WEIGHT_LOSS'
          ? 'Cardio: 35–40 min Incline Treadmill Walk (12% incline, 4.5 km/h) or Cycling'
          : type === 'WEIGHT_GAIN'
          ? 'Light Cardio / Mobility: 15–20 min low-intensity walk + full body stretching'
          : 'Cardio Intervals: 20 min HIIT (30s sprint / 60s walk) + 10 min core circuit',
        'Abdominal Crunches & Russian Twists: 3 sets x 20 reps',
        'Foam Rolling & Hip Mobility Drill: 10 mins',
      ],
    },
    {
      focus: 'Day 4: Push Hypertrophy (Chest, Shoulders, Triceps)',
      details: [
        'Incline Dumbbell Press: 4 sets x 8–12 reps',
        'Dumbbell Flat Press / Dips: 3 sets x 10–12 reps',
        'Cable Lateral Raises: 4 sets x 12–15 reps',
        'Cable Pec Fly: 3 sets x 12–15 reps',
        'Tricep Rope Pushdown superset with Overhead Extension: 3 sets x 12 reps',
      ],
    },
    {
      focus: 'Day 5: Pull Hypertrophy (Back, Rear Delts, Biceps)',
      details: [
        'Neutral Grip Lat Pulldown: 4 sets x 8–12 reps',
        'Chest-Supported Row: 4 sets x 10–12 reps',
        'Face Pulls (Rear Delts & Rotator Cuff): 4 sets x 15 reps',
        'Incline Dumbbell Bicep Curls: 3 sets x 10–12 reps',
        'Hammer Curls: 3 sets x 12 reps',
      ],
    },
    {
      focus: 'Day 6: Legs & Glutes Hypertrophy',
      details: [
        'Bulgarian Split Squats / Walking Lunges: 3 sets x 10 reps per leg',
        'Leg Extension: 3 sets x 12–15 reps',
        'Lying or Seated Hamstring Curl: 4 sets x 10–12 reps',
        'Seated Calf Raise: 3 sets x 15 reps',
        'Cable Woodchoppers: 3 sets x 15 reps per side',
      ],
    },
    {
      focus: 'Day 7: Full Rest & Regeneration',
      details: [
        'Complete physical rest from heavy resistance training',
        'Light leisure walking (20–30 min) encouraged',
        'Focus on hydration, whole foods, and 8+ hours quality sleep',
      ],
    },
  ];

  const fullSchedule: { day: number; week: number; focus: string; details: string[] }[] = [];

  for (let week = 1; week <= 4; week++) {
    for (let i = 0; i < weeklySplit.length; i++) {
      const dayNumber = (week - 1) * 7 + (i + 1);
      fullSchedule.push({
        day: dayNumber,
        week,
        focus: `Week ${week} - ${weeklySplit[i].focus}`,
        details: weeklySplit[i].details,
      });
    }
  }

  return fullSchedule;
}

export async function generatePlanPDF(user: UserMetrics): Promise<GeneratedPlan> {
  const analysis = analyzeUserMetrics(user.heightCm, user.weightKg);
  const { type, bmi, bmiCategory } = analysis;
  const recommendations = buildRecommendations(analysis, user);
  const workoutsByDay = generateWorkoutSplit(type);

  const doc = new PDFDocument({
    size: 'A4',
    margin: 40,
    info: {
      Title: `Fitness Plan - ${user.name}`,
      Author: 'GYM PRO System',
    },
  });

  const chunks: Buffer[] = [];
  const pdfBuffer: Buffer = await new Promise((resolve, reject) => {
    doc.on('data', (c: Buffer | Uint8Array) => chunks.push(Buffer.from(c)));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header Title
    doc.rect(40, 40, 515, 60).fill('#0F172A');
    doc.fillColor('#FFFFFF').fontSize(18).font('Helvetica-Bold').text('GYM PRO FITNESS & NUTRITION PLAN', 50, 52, { align: 'center' });
    doc.fontSize(11).font('Helvetica').text('Personalized 30-Day Physical Health & Workout Analysis', 50, 75, { align: 'center' });

    doc.moveDown(2);
    doc.fillColor('#000000');

    // User Metrics & Analysis Card
    const cardTop = 115;
    doc.rect(40, cardTop, 515, 120).strokeColor('#CBD5E1').lineWidth(1).stroke();
    doc.rect(40, cardTop, 515, 24).fill('#F1F5F9');
    doc.fillColor('#1E293B').fontSize(12).font('Helvetica-Bold').text('MEMBER PROFILE & PHYSICAL ASSESSMENT', 50, cardTop + 7);

    doc.fontSize(10).font('Helvetica').fillColor('#334155');
    
    // Column 1
    doc.text(`Member Name: `, 50, cardTop + 35, { continued: true }).font('Helvetica-Bold').text(user.name);
    doc.font('Helvetica').text(`Email Address: `, 50, cardTop + 52, { continued: true }).font('Helvetica-Bold').text(user.email);
    doc.font('Helvetica').text(`Assigned Plan: `, 50, cardTop + 69, { continued: true }).font('Helvetica-Bold').text(type.replace('_', ' '));
    doc.font('Helvetica').text(`Assessment: `, 50, cardTop + 86, { continued: true }).font('Helvetica-Bold').text(bmiCategory);

    // Column 2
    const col2X = 300;
    doc.font('Helvetica').text(`Height: `, col2X, cardTop + 35, { continued: true }).font('Helvetica-Bold').text(user.heightCm ? `${user.heightCm} cm` : 'Not provided');
    doc.font('Helvetica').text(`Weight: `, col2X, cardTop + 52, { continued: true }).font('Helvetica-Bold').text(user.weightKg ? `${round(user.weightKg, 1)} kg` : 'Not provided');
    doc.font('Helvetica').text(`Body Mass Index (BMI): `, col2X, cardTop + 69, { continued: true }).font('Helvetica-Bold').text(bmi ? `${bmi}` : 'N/A');
    if (analysis.idealWeightRange) {
      doc.font('Helvetica').text(`Ideal Weight Range: `, col2X, cardTop + 86, { continued: true }).font('Helvetica-Bold').text(`${analysis.idealWeightRange.min} - ${analysis.idealWeightRange.max} kg`);
    }

    doc.y = cardTop + 135;

    // Macro & Nutrition Targets Box (if available)
    if (analysis.targetCalories) {
      const nutTop = doc.y;
      doc.rect(40, nutTop, 515, 65).fill('#F8FAFC');
      doc.rect(40, nutTop, 515, 65).strokeColor('#E2E8F0').lineWidth(1).stroke();

      doc.fillColor('#0F172A').fontSize(11).font('Helvetica-Bold').text('DAILY NUTRITIONAL & HYDRATION TARGETS', 50, nutTop + 8);
      
      doc.fontSize(9.5).font('Helvetica').fillColor('#334155');
      doc.text(`Calories: ~${analysis.targetCalories} kcal/day`, 50, nutTop + 28);
      doc.text(`Protein: ${analysis.targetProteinGrams} g/day`, 170, nutTop + 28);
      doc.text(`Carbohydrates: ${analysis.targetCarbsGrams} g/day`, 280, nutTop + 28);
      doc.text(`Healthy Fats: ${analysis.targetFatsGrams} g/day`, 410, nutTop + 28);
      
      doc.text(`Daily Water Intake: Minimum ${analysis.targetWaterLiters} Liters/day`, 50, nutTop + 45);
      doc.y = nutTop + 75;
    } else {
      doc.moveDown(1);
    }

    // Recommendations Section
    doc.fontSize(13).font('Helvetica-Bold').fillColor('#0F172A').text('Personalized Strategic Recommendations', 40, doc.y);
    doc.moveDown(0.4);
    
    recommendations.forEach((rec) => {
      doc.fontSize(9.5).font('Helvetica').fillColor('#1E293B');
      doc.circle(48, doc.y + 5, 2.5).fill('#0284C7');
      doc.text(rec, 58, doc.y, { width: 495 });
      doc.moveDown(0.35);
    });

    doc.moveDown(0.8);

    // Workout Routine Section
    doc.fontSize(13).font('Helvetica-Bold').fillColor('#0F172A').text('30-Day Periodized Workout Schedule', 40, doc.y);
    doc.moveDown(0.4);

    let currentWeek = 0;

    workoutsByDay.forEach((workout) => {
      // Check page overflow
      if (doc.y > 700) {
        doc.addPage();
      }

      if (workout.week !== currentWeek) {
        currentWeek = workout.week;
        doc.moveDown(0.3);
        doc.rect(40, doc.y, 515, 18).fill('#E2E8F0');
        doc.fillColor('#0F172A').fontSize(10).font('Helvetica-Bold').text(`WEEK ${currentWeek} SCHEDULE`, 48, doc.y + 4);
        doc.moveDown(0.8);
      }

      doc.fillColor('#0284C7').fontSize(9.5).font('Helvetica-Bold').text(`Day ${workout.day}: ${workout.focus.split(' - ')[1] || workout.focus}`, 45, doc.y);
      doc.moveDown(0.2);

      workout.details.forEach((det) => {
        doc.fillColor('#334155').fontSize(8.5).font('Helvetica').text(`   • ${det}`, 52, doc.y, { width: 490 });
        doc.moveDown(0.15);
      });

      doc.moveDown(0.3);
    });

    doc.end();
  });

  return {
    type,
    bmi: bmi ?? undefined,
    bmiCategory,
    analysis,
    recommendations,
    workoutsByDay,
    pdfBuffer,
  };
}
