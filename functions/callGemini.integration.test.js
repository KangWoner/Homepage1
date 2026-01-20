/**
 * Integration tests for callGemini function from actual index.js
 * Tests the real implementation with mocked VertexAI
 */

const { VertexAI } = require('@google-cloud/vertexai');

// Mock VertexAI before requiring index
jest.mock('@google-cloud/vertexai');
jest.mock('firebase-admin', () => ({
  initializeApp: jest.fn(),
  firestore: jest.fn(),
}));
jest.mock('firebase-functions/v2/https');
jest.mock('firebase-functions/v2/tasks');

describe('callGemini integration tests', () => {
  let callGemini;
  let mockGenerativeModel;
  let mockGetGenerativeModel;

  beforeAll(() => {
    // Setup mocks before requiring index.js
    mockGenerativeModel = {
      generateContentStream: jest.fn(),
    };

    mockGetGenerativeModel = jest.fn().mockReturnValue(mockGenerativeModel);

    VertexAI.mockImplementation(() => ({
      preview: {
        getGenerativeModel: mockGetGenerativeModel,
      },
    }));

    // Now require index.js which will use our mocks
    const indexModule = require('./index.js');
    callGemini = indexModule.callGemini;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Real callGemini function', () => {
    test('should parse JSON with responseMimeType', async () => {
      const mockResponse = {
        response: {
          candidates: [{
            content: {
              parts: [{
                text: '{"score": 100, "valid": true}'
              }]
            }
          }]
        }
      };

      mockGenerativeModel.generateContentStream.mockResolvedValue(mockResponse);

      const result = await callGemini(
        'Test system',
        'Test prompt',
        null,
        { responseMimeType: 'application/json' }
      );

      expect(result).toEqual({ score: 100, valid: true });
    });

    test('should parse JSON from markdown code block', async () => {
      const mockResponse = {
        response: {
          candidates: [{
            content: {
              parts: [{
                text: '```json\n{"errors": [], "deduction": 10}\n```'
              }]
            }
          }]
        }
      };

      mockGenerativeModel.generateContentStream.mockResolvedValue(mockResponse);

      const result = await callGemini('Test', 'Test');

      expect(result).toEqual({ errors: [], deduction: 10 });
    });

    test('should handle API errors and return error object', async () => {
      mockGenerativeModel.generateContentStream.mockRejectedValue(
        new Error('Vertex AI quota exceeded')
      );

      const result = await callGemini('Test', 'Test');

      expect(result).toEqual({
        error: 'AI Generation Failed',
        details: 'Vertex AI quota exceeded'
      });
    });

    test('should include image data when provided', async () => {
      const mockResponse = {
        response: {
          candidates: [{
            content: {
              parts: [{
                text: '{"analyzed": true}'
              }]
            }
          }]
        }
      };

      mockGenerativeModel.generateContentStream.mockResolvedValue(mockResponse);

      const imagePart = {
        mimeType: 'image/png',
        data: 'base64data'
      };

      await callGemini('Analyze', 'Describe', imagePart);

      const callArgs = mockGenerativeModel.generateContentStream.mock.calls[0][0];
      expect(callArgs.contents[0].parts).toHaveLength(2);
      expect(callArgs.contents[0].parts[1]).toEqual({ inlineData: imagePart });
    });

    test('should return text object when response is not JSON', async () => {
      const mockResponse = {
        response: {
          candidates: [{
            content: {
              parts: [{
                text: 'This is plain text response'
              }]
            }
          }]
        }
      };

      mockGenerativeModel.generateContentStream.mockResolvedValue(mockResponse);

      const result = await callGemini('Test', 'Test');

      expect(result).toEqual({ text: 'This is plain text response' });
    });
  });
});
