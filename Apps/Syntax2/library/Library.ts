export const CompareTitles = (left: string, right: string): 'less' | 'equal' | 'greater' =>
  left < right ? 'less' : left > right ? 'greater' : 'equal'

export const AddScores = (left: number, right: number): number => left + right
