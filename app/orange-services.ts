export type OrangeServicePackage = { code: string; description: string; unit: string; qafRow: number };

export const orangeServicePackages: OrangeServicePackage[] = [
  { code: "SP1 FO", description: "Reparații în site / ODF / patch", unit: "intervenție", qafRow: 4 },
  { code: "SP2 FOA", description: "Reparații aeriene fără cablu nou", unit: "intervenție", qafRow: 5 },
  { code: "SP3 FOA", description: "Reparații aeriene cu sub 200 m cablu nou", unit: "intervenție", qafRow: 6 },
  { code: "CR4 FOA", description: "Reparații aeriene cu peste 200 m cablu nou", unit: "intervenție", qafRow: 7 },
  { code: "SP5 FOU", description: "Reparații subterane cu maximum 100 m cablu", unit: "intervenție", qafRow: 8 },
  { code: "CR6 FOU", description: "Reparații subterane cu 100–300 m cablu", unit: "intervenție", qafRow: 9 },
  { code: "CR7 FOU", description: "Reparații subterane cu peste 300 m cablu", unit: "intervenție", qafRow: 10 },
];
