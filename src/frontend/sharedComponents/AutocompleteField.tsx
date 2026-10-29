import * as React from 'react';
import {
  Keyboard,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Ionicons from '@react-native-vector-icons/ionicons';

import {BodyText} from './Text/BodyText';
import {COIAB_BEIGE, WHITE} from '../lib/styles';

// Figma "Kutary App - V2", `2708:3381` / `2181:11109` (`Fields-Search`).
// The field is outlined on the dark onboarding surface, not a filled green
// rectangle; the suggestion panel is a slightly lighter dark green.
const FIELD_BORDER = '#DABA8D';
const SUGGESTION_BACKGROUND = '#293833';
const SUGGESTION_BORDER = '#668073';
const PLACEHOLDER_COLOR = 'rgba(255, 255, 255, 0.5)';

type AutocompleteFieldProps = {
  value: string;
  onChangeText: (text: string) => void;
  suggestions: string[];
  onSelect: (name: string) => void;
  placeholder?: string;
  testID?: string;
  maxLength?: number;
  accessibilityLabel?: string;
};

/**
 * Campo de texto livre com sugestões locais (#128). Digitar continua
 * permitindo qualquer valor: a lista é um atalho, não uma validação. A lista
 * só aparece com foco (ou edição desde a última escolha) e texto não vazio;
 * sem sugestões não ocupa espaço.
 */
export const AutocompleteField = ({
  value,
  onChangeText,
  suggestions,
  onSelect,
  placeholder,
  testID,
  maxLength = 100,
  accessibilityLabel,
}: AutocompleteFieldProps) => {
  const [focused, setFocused] = React.useState(false);
  // Escolher uma sugestão fecha a lista mesmo com o input ainda focado
  // (`keyboardShouldPersistTaps="handled"`). Editar depois da escolha reabre a
  // lista sem depender de um novo `onFocus`.
  const [editedSinceSelect, setEditedSinceSelect] = React.useState(false);
  const inputRef = React.useRef<TextInput>(null);
  // No toque da sugestão o TextInput perde o foco antes do onPress; marcar
  // "selecionando" no onPressIn evita desmontar a lista no meio do toque.
  const selecting = React.useRef(false);

  const showSuggestions =
    (focused || editedSinceSelect) &&
    value.trim().length > 0 &&
    suggestions.length > 0;

  function handleChangeText(text: string) {
    // Edição é uma fonte de visibilidade independente do foco: apagar tudo
    // fecha a lista, qualquer texto reabre com as sugestões filtradas.
    setEditedSinceSelect(text.trim().length > 0);
    onChangeText(text);
  }

  function closeSuggestions() {
    setFocused(false);
    setEditedSinceSelect(false);
    inputRef.current?.blur();
  }

  function handleSelect(name: string) {
    selecting.current = false;
    closeSuggestions();
    Keyboard.dismiss();
    onSelect(name);
  }

  function handleToggleSuggestions() {
    if (showSuggestions) {
      closeSuggestions();
      return;
    }
    setFocused(true);
    inputRef.current?.focus();
  }

  return (
    <View>
      <View
        testID={testID ? `${testID}-field` : undefined}
        style={styles.inputRow}>
        <TextInput
          ref={inputRef}
          testID={testID}
          accessibilityLabel={accessibilityLabel}
          value={value}
          onChangeText={handleChangeText}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            if (!selecting.current) {
              setFocused(false);
              setEditedSinceSelect(false);
            }
          }}
          placeholder={placeholder}
          placeholderTextColor={PLACEHOLDER_COLOR}
          style={styles.input}
          maxLength={maxLength}
          autoCorrect={false}
          returnKeyType="done"
        />
        <TouchableOpacity
          testID={testID ? `${testID}-toggle` : undefined}
          accessibilityRole="button"
          onPress={handleToggleSuggestions}
          hitSlop={8}>
          <Ionicons
            name="chevron-down"
            size={20}
            color={COIAB_BEIGE}
            style={styles.chevron}
          />
        </TouchableOpacity>
      </View>
      {showSuggestions ? (
        <View style={styles.suggestionList}>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            style={styles.suggestionScroll}>
            {suggestions.map(name => (
              <TouchableOpacity
                key={name}
                testID={testID ? `${testID}-suggestion-${name}` : undefined}
                accessibilityRole="button"
                accessibilityLabel={name}
                onPressIn={() => {
                  selecting.current = true;
                }}
                onPress={() => handleSelect(name)}
                style={styles.suggestionItem}>
                <BodyText style={styles.suggestionText}>{name}</BodyText>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  inputRow: {
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 2,
    borderColor: FIELD_BORDER,
    backgroundColor: 'transparent',
    paddingHorizontal: 16,
  },
  input: {
    flex: 1,
    height: 48,
    padding: 0,
    color: WHITE,
    fontSize: 16,
  },
  chevron: {
    marginLeft: 8,
  },
  suggestionList: {
    marginTop: 4,
    maxHeight: 200,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: SUGGESTION_BORDER,
    backgroundColor: SUGGESTION_BACKGROUND,
    overflow: 'hidden',
  },
  suggestionScroll: {
    maxHeight: 200,
  },
  suggestionItem: {
    height: 48,
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  suggestionText: {
    color: WHITE,
  },
});
