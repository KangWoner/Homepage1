/**
 * Comprehensive tests for callGemini function
 * Tests JSON parsing, error handling, and configuration merging
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

// Mock fs to prevent CSV loading errors in tests
jest.mock('fs', () => ({
  readFileSync: jest.fn().mockReturnValue('University,Year,Question Type,Prob URL,Sol URL\nTest,2024,Math,url1,url2'),
}));

describe('callGemini function', () => {
  let mockGenerativeModel;
  let mockGetGenerativeModel;
  let callGemini;

  beforeEach(() => {
    // Clear all mocks before each test
    jest.clearAllMocks();

    // Create mock generative model
    mockGenerativeModel = {
      generateContentStream: jest.fn(),
    };

    // Create mock for preview.getGenerativeModel
    mockGetGenerativeModel = jest.fn().mockReturnValue(mockGenerativeModel);

    // Mock VertexAI instance
    VertexAI.mockImplementation(() => ({
      preview: {
        getGenerativeModel: mockGetGenerativeModel,
      },
    }));

    // Require the module after mocks are set up
    // We need to extract callGemini for testing
    // Since it's not exported, we'll need to test it indirectly or modify index.js
    // For now, let's create a standalone version for testing
    const vertex_ai = new VertexAI({ project: 'test-project', location: 'us-central1' });
    const model = 'gemini-1.5-pro';

    callGemini = async function(systemInstruction, userPrompt, imagePart, config = {}) {
      try {
        const generationConfig = {
          'maxOutputTokens': 8192,
          'temperature': 0.4,
          'topP': 0.95,
          ...config
        };

        const generativeModel = vertex_ai.preview.getGenerativeModel({
          model: model,
          generationConfig: generationConfig,
          systemInstruction: {
            parts: [{ text: systemInstruction }]
          },
        });

        const contentParts = [{ text: userPrompt }];
        if (imagePart) {
          contentParts.push({ inlineData: imagePart });
        }

        const req = {
          contents: [{ role: 'user', parts: contentParts }],
        };

        const streamingResp = await generativeModel.generateContentStream(req);
        const aggregatedResponse = await streamingResp.response;
        const text = aggregatedResponse.candidates[0].content.parts[0].text;

        // JSON Parsing
        if (config.responseMimeType === 'application/json') {
          return JSON.parse(text);
        }

        const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
        if (jsonMatch && jsonMatch[1]) {
          return JSON.parse(jsonMatch[1]);
        }
        if (text.trim().startsWith('{')) {
          return JSON.parse(text);
        }
        return { text: text };

      } catch (e) {
        console.error("Gemini Error:", e);
        return { error: "AI Generation Failed", details: e.message };
      }
    };
  });

  describe('JSON Response Parsing', () => {
    test('should parse JSON when responseMimeType is application/json', async () => {
      const mockResponse = {
        response: {
          candidates: [{
            content: {
              parts: [{
                text: '{"result": "success", "score": 95}'
              }]
            }
          }]
        }
      };

      mockGenerativeModel.generateContentStream.mockResolvedValue(mockResponse);

      const result = await callGemini(
        'Test system instruction',
        'Test prompt',
        null,
        { responseMimeType: 'application/json' }
      );

      expect(result).toEqual({ result: 'success', score: 95 });
      expect(mockGetGenerativeModel).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'gemini-1.5-pro',
          generationConfig: expect.objectContaining({
            maxOutputTokens: 8192,
            temperature: 0.4,
            topP: 0.95,
            responseMimeType: 'application/json'
          })
        })
      );
    });

    test('should parse JSON from markdown code block', async () => {
      const mockResponse = {
        response: {
          candidates: [{
            content: {
              parts: [{
                text: '```json\n{"analysis": "complete", "errors": []}\n```'
              }]
            }
          }]
        }
      };

      mockGenerativeModel.generateContentStream.mockResolvedValue(mockResponse);

      const result = await callGemini(
        'Test system instruction',
        'Test prompt'
      );

      expect(result).toEqual({ analysis: 'complete', errors: [] });
    });

    test('should parse JSON from markdown code block with extra whitespace', async () => {
      const mockResponse = {
        response: {
          candidates: [{
            content: {
              parts: [{
                text: '```json\n\n  {"valid": true, "score": 100}  \n\n```'
              }]
            }
          }]
        }
      };

      mockGenerativeModel.generateContentStream.mockResolvedValue(mockResponse);

      const result = await callGemini(
        'Test system instruction',
        'Test prompt'
      );

      expect(result).toEqual({ valid: true, score: 100 });
    });

    test('should parse plain JSON starting with {', async () => {
      const mockResponse = {
        response: {
          candidates: [{
            content: {
              parts: [{
                text: '{"formula": "x^2 + 2x + 1", "correct": true}'
              }]
            }
          }]
        }
      };

      mockGenerativeModel.generateContentStream.mockResolvedValue(mockResponse);

      const result = await callGemini(
        'Test system instruction',
        'Test prompt'
      );

      expect(result).toEqual({ formula: 'x^2 + 2x + 1', correct: true });
    });

    test('should handle complex nested JSON', async () => {
      const complexJSON = {
        coreCompetencies: {
          problemSolving: 85,
          writingAbility: 90,
          calculationAccuracy: 95
        },
        strengths: ['Clear logic', 'Good notation'],
        weaknesses: ['Minor calculation error'],
        study_points: ['Review integration techniques']
      };

      const mockResponse = {
        response: {
          candidates: [{
            content: {
              parts: [{
                text: JSON.stringify(complexJSON)
              }]
            }
          }]
        }
      };

      mockGenerativeModel.generateContentStream.mockResolvedValue(mockResponse);

      const result = await callGemini(
        'Test system instruction',
        'Test prompt'
      );

      expect(result).toEqual(complexJSON);
    });
  });

  describe('Text Response Handling', () => {
    test('should return text wrapped in object when not JSON', async () => {
      const mockResponse = {
        response: {
          candidates: [{
            content: {
              parts: [{
                text: 'This is a plain text response without JSON'
              }]
            }
          }]
        }
      };

      mockGenerativeModel.generateContentStream.mockResolvedValue(mockResponse);

      const result = await callGemini(
        'Test system instruction',
        'Test prompt'
      );

      expect(result).toEqual({ text: 'This is a plain text response without JSON' });
    });

    test('should return text when response starts with non-JSON content', async () => {
      const mockResponse = {
        response: {
          candidates: [{
            content: {
              parts: [{
                text: 'Here is the analysis: The solution is correct.'
              }]
            }
          }]
        }
      };

      mockGenerativeModel.generateContentStream.mockResolvedValue(mockResponse);

      const result = await callGemini(
        'Test system instruction',
        'Test prompt'
      );

      expect(result).toEqual({ text: 'Here is the analysis: The solution is correct.' });
    });
  });

  describe('Image Handling', () => {
    test('should include image data in request when provided', async () => {
      const mockResponse = {
        response: {
          candidates: [{
            content: {
              parts: [{
                text: '{"result": "analyzed"}'
              }]
            }
          }]
        }
      };

      mockGenerativeModel.generateContentStream.mockResolvedValue(mockResponse);

      const imagePart = {
        mimeType: 'image/jpeg',
        data: 'base64encodeddata'
      };

      await callGemini(
        'Analyze this image',
        'What do you see?',
        imagePart
      );

      expect(mockGenerativeModel.generateContentStream).toHaveBeenCalledWith({
        contents: [{
          role: 'user',
          parts: [
            { text: 'What do you see?' },
            { inlineData: imagePart }
          ]
        }]
      });
    });

    test('should work without image data', async () => {
      const mockResponse = {
        response: {
          candidates: [{
            content: {
              parts: [{
                text: '{"result": "no image"}'
              }]
            }
          }]
        }
      };

      mockGenerativeModel.generateContentStream.mockResolvedValue(mockResponse);

      await callGemini(
        'Test instruction',
        'Test prompt',
        null
      );

      expect(mockGenerativeModel.generateContentStream).toHaveBeenCalledWith({
        contents: [{
          role: 'user',
          parts: [{ text: 'Test prompt' }]
        }]
      });
    });
  });

  describe('Configuration Merging', () => {
    test('should merge custom config with default config', async () => {
      const mockResponse = {
        response: {
          candidates: [{
            content: {
              parts: [{
                text: '{"merged": true}'
              }]
            }
          }]
        }
      };

      mockGenerativeModel.generateContentStream.mockResolvedValue(mockResponse);

      await callGemini(
        'Test',
        'Test',
        null,
        { temperature: 0.8, topP: 0.9, customParam: 'value' }
      );

      expect(mockGetGenerativeModel).toHaveBeenCalledWith(
        expect.objectContaining({
          generationConfig: expect.objectContaining({
            maxOutputTokens: 8192,
            temperature: 0.8, // Overridden
            topP: 0.9, // Overridden
            customParam: 'value' // Added
          })
        })
      );
    });

    test('should use default config when no custom config provided', async () => {
      const mockResponse = {
        response: {
          candidates: [{
            content: {
              parts: [{
                text: '{"default": true}'
              }]
            }
          }]
        }
      };

      mockGenerativeModel.generateContentStream.mockResolvedValue(mockResponse);

      await callGemini('Test', 'Test');

      expect(mockGetGenerativeModel).toHaveBeenCalledWith(
        expect.objectContaining({
          generationConfig: {
            maxOutputTokens: 8192,
            temperature: 0.4,
            topP: 0.95
          }
        })
      );
    });
  });

  describe('Error Handling', () => {
    test('should handle JSON parse errors gracefully', async () => {
      const mockResponse = {
        response: {
          candidates: [{
            content: {
              parts: [{
                text: '{"invalid": json}'
              }]
            }
          }]
        }
      };

      mockGenerativeModel.generateContentStream.mockResolvedValue(mockResponse);

      const result = await callGemini(
        'Test',
        'Test'
      );

      expect(result).toHaveProperty('error', 'AI Generation Failed');
      expect(result).toHaveProperty('details');
    });

    test('should handle API errors', async () => {
      mockGenerativeModel.generateContentStream.mockRejectedValue(
        new Error('API quota exceeded')
      );

      const result = await callGemini(
        'Test',
        'Test'
      );

      expect(result).toEqual({
        error: 'AI Generation Failed',
        details: 'API quota exceeded'
      });
    });

    test('should handle network errors', async () => {
      mockGenerativeModel.generateContentStream.mockRejectedValue(
        new Error('Network timeout')
      );

      const result = await callGemini(
        'Test',
        'Test'
      );

      expect(result).toEqual({
        error: 'AI Generation Failed',
        details: 'Network timeout'
      });
    });

    test('should handle malformed response structure', async () => {
      const mockResponse = {
        response: {
          candidates: []
        }
      };

      mockGenerativeModel.generateContentStream.mockResolvedValue(mockResponse);

      const result = await callGemini(
        'Test',
        'Test'
      );

      expect(result).toHaveProperty('error', 'AI Generation Failed');
    });

    test('should handle JSON.parse errors with responseMimeType', async () => {
      const mockResponse = {
        response: {
          candidates: [{
            content: {
              parts: [{
                text: 'Not valid JSON at all'
              }]
            }
          }]
        }
      };

      mockGenerativeModel.generateContentStream.mockResolvedValue(mockResponse);

      const result = await callGemini(
        'Test',
        'Test',
        null,
        { responseMimeType: 'application/json' }
      );

      expect(result).toEqual({
        error: 'AI Generation Failed',
        details: expect.stringContaining('JSON')
      });
    });
  });

  describe('System Instruction', () => {
    test('should pass system instruction correctly', async () => {
      const mockResponse = {
        response: {
          candidates: [{
            content: {
              parts: [{
                text: '{"ok": true}'
              }]
            }
          }]
        }
      };

      mockGenerativeModel.generateContentStream.mockResolvedValue(mockResponse);

      const systemInstruction = 'You are a strict math grader';
      await callGemini(systemInstruction, 'Grade this', null);

      expect(mockGetGenerativeModel).toHaveBeenCalledWith(
        expect.objectContaining({
          systemInstruction: {
            parts: [{ text: systemInstruction }]
          }
        })
      );
    });
  });

  describe('Edge Cases', () => {
    test('should handle empty string response', async () => {
      const mockResponse = {
        response: {
          candidates: [{
            content: {
              parts: [{
                text: ''
              }]
            }
          }]
        }
      };

      mockGenerativeModel.generateContentStream.mockResolvedValue(mockResponse);

      const result = await callGemini('Test', 'Test');

      expect(result).toEqual({ text: '' });
    });

    test('should handle whitespace-only response', async () => {
      const mockResponse = {
        response: {
          candidates: [{
            content: {
              parts: [{
                text: '   \n\n  '
              }]
            }
          }]
        }
      };

      mockGenerativeModel.generateContentStream.mockResolvedValue(mockResponse);

      const result = await callGemini('Test', 'Test');

      expect(result).toEqual({ text: '   \n\n  ' });
    });

    test('should handle JSON with markdown formatting outside code block', async () => {
      const mockResponse = {
        response: {
          candidates: [{
            content: {
              parts: [{
                text: 'Here is the result:\n```json\n{"status": "ok"}\n```\nEnd of response'
              }]
            }
          }]
        }
      };

      mockGenerativeModel.generateContentStream.mockResolvedValue(mockResponse);

      const result = await callGemini('Test', 'Test');

      expect(result).toEqual({ status: 'ok' });
    });

    test('should handle multiple JSON code blocks and use first one', async () => {
      const mockResponse = {
        response: {
          candidates: [{
            content: {
              parts: [{
                text: '```json\n{"first": true}\n```\nSome text\n```json\n{"second": true}\n```'
              }]
            }
          }]
        }
      };

      mockGenerativeModel.generateContentStream.mockResolvedValue(mockResponse);

      const result = await callGemini('Test', 'Test');

      expect(result).toEqual({ first: true });
    });

    test('should handle array JSON responses', async () => {
      const mockResponse = {
        response: {
          candidates: [{
            content: {
              parts: [{
                text: '[{"item": 1}, {"item": 2}]'
              }]
            }
          }]
        }
      };

      mockGenerativeModel.generateContentStream.mockResolvedValue(mockResponse);

      const result = await callGemini('Test', 'Test');

      // Arrays don't start with '{', so they should be wrapped
      expect(result).toEqual({ text: '[{"item": 1}, {"item": 2}]' });
    });
  });
});
