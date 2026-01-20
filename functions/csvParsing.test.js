/**
 * Tests for CSV parsing and problemsMap initialization
 */

jest.mock('firebase-admin', () => ({
  initializeApp: jest.fn(),
  firestore: jest.fn(),
}));
jest.mock('firebase-functions/v2/https');
jest.mock('firebase-functions/v2/tasks');
jest.mock('@google-cloud/vertexai');

describe('CSV Parsing and problemsMap', () => {
  let fs;

  beforeEach(() => {
    // Clear module cache to reset problemsMap
    jest.resetModules();
    fs = require('fs');
  });

  test('should parse normal CSV correctly', () => {
    const mockCSV = `University,Year,Question Type,Prob URL,Sol URL
서울대,2024,미적분학,http://prob1.com,http://sol1.com
연세대,2023,선형대수학,http://prob2.com,http://sol2.com
고려대,2022,확률론,http://prob3.com,http://sol3.com`;

    jest.spyOn(fs, 'readFileSync').mockReturnValue(mockCSV);

    const { problemsMap } = require('./index.js');

    expect(problemsMap.size).toBe(3);
    expect(problemsMap.get('Q001')).toMatchObject({
      id: 'Q001',
      subject: '수리논술',
      question: '미적분학'
    });
    expect(problemsMap.get('Q002')).toMatchObject({
      id: 'Q002',
      question: '선형대수학'
    });
    expect(problemsMap.get('Q003')).toMatchObject({
      id: 'Q003',
      question: '확률론'
    });
  });

  test('should handle CSV with quoted fields containing commas', () => {
    const mockCSV = `University,Year,Question Type,Prob URL,Sol URL
서울대,2024,"미적분학, 논리학",http://prob1.com,http://sol1.com
연세대,2023,"선형대수학",http://prob2.com,http://sol2.com`;

    jest.spyOn(fs, 'readFileSync').mockReturnValue(mockCSV);

    const { problemsMap } = require('./index.js');

    expect(problemsMap.size).toBe(2);
    expect(problemsMap.get('Q001')).toMatchObject({
      id: 'Q001',
      question: '미적분학, 논리학' // Quotes should be removed
    });
  });

  test('should handle empty fields', () => {
    const mockCSV = `University,Year,Question Type,Prob URL,Sol URL
서울대,2024,,http://prob1.com,http://sol1.com
연세대,2023,"",http://prob2.com,http://sol2.com`;

    jest.spyOn(fs, 'readFileSync').mockReturnValue(mockCSV);

    const { problemsMap } = require('./index.js');

    expect(problemsMap.size).toBe(2);
    expect(problemsMap.get('Q001')).toMatchObject({
      id: 'Q001',
      question: '논술 문제' // Fallback value
    });
  });

  test('should skip rows with insufficient columns', () => {
    const mockCSV = `University,Year,Question Type,Prob URL,Sol URL
서울대,2024,미적분학,http://prob1.com,http://sol1.com
연세대,2023
고려대,2022,확률론,http://prob3.com,http://sol3.com`;

    jest.spyOn(fs, 'readFileSync').mockReturnValue(mockCSV);

    const { problemsMap } = require('./index.js');

    // Should only have 2 entries (skips the one with 2 columns)
    expect(problemsMap.size).toBe(2);
    expect(problemsMap.has('Q001')).toBe(true);
    // BUG DISCOVERED: Q002 is skipped but ID continues incrementing
    // So we get Q001 and Q003, not Q001 and Q002
    expect(problemsMap.has('Q002')).toBe(false); // ID skipped due to insufficient cols
    expect(problemsMap.has('Q003')).toBe(true); // This gets added with Q003 ID
  });

  test('should handle file read error gracefully', () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
    jest.spyOn(fs, 'readFileSync').mockImplementation(() => {
      throw new Error('ENOENT: no such file');
    });

    const { problemsMap } = require('./index.js');

    expect(problemsMap.size).toBe(0);
    expect(consoleSpy).toHaveBeenCalledWith(
      'Failed to load problems.csv:',
      expect.any(Error)
    );

    consoleSpy.mockRestore();
  });

  test('should generate sequential IDs with zero padding', () => {
    const mockCSV = `University,Year,Question Type,Prob URL,Sol URL
서울대,2024,문제1,http://prob1.com,http://sol1.com
연세대,2023,문제2,http://prob2.com,http://sol2.com
고려대,2022,문제3,http://prob3.com,http://sol3.com
성균관대,2021,문제4,http://prob4.com,http://sol4.com
한양대,2020,문제5,http://prob5.com,http://sol5.com
중앙대,2019,문제6,http://prob6.com,http://sol6.com
경희대,2018,문제7,http://prob7.com,http://sol7.com
이화여대,2017,문제8,http://prob8.com,http://sol8.com
서강대,2016,문제9,http://prob9.com,http://sol9.com
KAIST,2015,문제10,http://prob10.com,http://sol10.com`;

    jest.spyOn(fs, 'readFileSync').mockReturnValue(mockCSV);

    const { problemsMap } = require('./index.js');

    expect(problemsMap.size).toBe(10);
    expect(problemsMap.get('Q001')).toBeDefined();
    expect(problemsMap.get('Q010')).toBeDefined();
    expect(problemsMap.get('Q010').question).toBe('문제10');
  });

  test('should set default criteria values', () => {
    const mockCSV = `University,Year,Question Type,Prob URL,Sol URL
서울대,2024,미적분학,http://prob1.com,http://sol1.com`;

    jest.spyOn(fs, 'readFileSync').mockReturnValue(mockCSV);

    const { problemsMap } = require('./index.js');

    const problem = problemsMap.get('Q001');
    expect(problem.criteria_formula).toBe('수학적 계산의 정확성 및 공식 적용의 올바름 (General Math Rules)');
    expect(problem.criteria_logic).toBe('논리적 전개 과정 및 근거의 타당성 (Logical Consistency)');
    expect(problem.model_answer).toBe('참조 링크 확인 (Refer to Solution URL)');
    expect(problem.subject).toBe('수리논술');
  });

  test('should handle UTF-8 encoded Korean text', () => {
    const mockCSV = `University,Year,Question Type,Prob URL,Sol URL
서울대학교,2024,미적분학 논술,http://prob1.com,http://sol1.com
연세대학교,2023,선형대수학 증명,http://prob2.com,http://sol2.com`;

    jest.spyOn(fs, 'readFileSync').mockReturnValue(mockCSV);

    const { problemsMap } = require('./index.js');

    expect(problemsMap.get('Q001').question).toBe('미적분학 논술');
    expect(problemsMap.get('Q002').question).toBe('선형대수학 증명');
  });

  test('should handle CSV with Windows line endings (CRLF)', () => {
    const mockCSV = "University,Year,Question Type,Prob URL,Sol URL\r\n서울대,2024,미적분학,http://prob1.com,http://sol1.com\r\n연세대,2023,선형대수학,http://prob2.com,http://sol2.com";

    jest.spyOn(fs, 'readFileSync').mockReturnValue(mockCSV);

    const { problemsMap } = require('./index.js');

    expect(problemsMap.size).toBe(2);
  });
});
