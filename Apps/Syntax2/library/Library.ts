import TR from '@tao/runtime'

export const CompareTitles = (left: string, right: string): 'less' | 'equal' | 'greater' =>
  left < right ? 'less' : left > right ? 'greater' : 'equal'

export const AddScores = (left: number, right: number): number => left + right

export function ValidateTitle(title: string): string {
  if (title.trim().length === 0) {
    return TR.Fail('InvalidFormat', 'Enter a nonblank title')
  }
  return title
}
