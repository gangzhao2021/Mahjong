// The China build must not link Google Play Services (PRD Appendix D.7); Google Sign-In brings them in.
const china = process.env.EXPO_PUBLIC_REGION === 'china';

module.exports = {
  dependencies: china ? { '@react-native-google-signin/google-signin': { platforms: { android: null, ios: null } } } : {},
};
