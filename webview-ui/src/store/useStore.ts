import { create } from 'zustand';
import type { CircuitLayout, CircuitMetadata, RenderReadyData, StepData } from '../types';

export interface AppState {
  steps: StepData[];
  currentStep: number;
  metadata: CircuitMetadata | null;
  layout: CircuitLayout | null;

  setData: (data: RenderReadyData) => void;
  setStep: (step: number) => void;
  nextStep: () => void;
  prevStep: () => void;
  reset: () => void;
}

export const useStore = create<AppState>((set, get) => ({
  steps: [],
  currentStep: 0,
  metadata: null,
  layout: null,

  setData: (data) =>
    set({
      steps: data.steps ?? [],
      metadata: data.metadata ?? null,
      layout: data.circuit_layout ?? null,
      currentStep: 0
    }),

  setStep: (step) => {
    const maxIndex = Math.max(get().steps.length - 1, 0);
    set({ currentStep: Math.min(Math.max(step, 0), maxIndex) });
  },

  nextStep: () => get().setStep(get().currentStep + 1),

  prevStep: () => get().setStep(get().currentStep - 1),

  reset: () => set({ steps: [], currentStep: 0, metadata: null, layout: null })
}));
