import React, { useCallback, useContext, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { find } from 'lodash';
import { Brackets } from 'typeorm/browser';
import RegexEscape from 'regex-escape';
import { Navigation } from 'react-native-navigation';
import { t } from 'ttag';

import { SORT_BY_ENCOUNTER_SET, SortType, DeckId } from '@actions/types';
import ArkhamSwitch from '@components/core/ArkhamSwitch';
import CollapsibleSearchBox from '@components/core/CollapsibleSearchBox';
import FilterBuilder, { FilterState } from '@lib/filters';
import {
  BASIC_QUERY,
  BROWSE_CARDS_QUERY,
  MYTHOS_CARDS_QUERY,
  BROWSE_CARDS_WITH_DUPLICATES_QUERY,
  NO_CUSTOM_CARDS_QUERY,
  NO_DUPLICATES_QUERY,
  where,
  combineQueries,
  combineQueriesOpt,
} from '@data/sqlite/query';
import Card, { searchNormalize } from '@data/types/Card';
import { s, xs } from '@styles/space';
import ArkhamButton from '@components/core/ArkhamButton';
import StyleContext from '@styles/StyleContext';
import DbCardResultList from './DbCardResultList';
import DeckNavFooter, { PreLoadedDeckNavFooter } from '@components/deck/DeckNavFooter';
import ActionButton from 'react-native-action-button';
import AppIcon from '@icons/AppIcon';
import { useFilterButton } from '../hooks';
import { NOTCH_BOTTOM_PADDING } from '@styles/sizes';
import LanguageContext from '@lib/i18n/LanguageContext';
import useDebouncedEffect from 'use-debounced-effect-hook';
import { useSettingValue } from '@components/core/hooks';
import { useParsedDeck } from '@components/deck/hooks';

const DIGIT_REGEX = /^[0-9]+$/;

interface Props {
  componentId: string;
  deckId?: DeckId;
  baseQuery?: (filters: FilterState | undefined) => Brackets;
  mythosToggle?: boolean;
  showNonCollection?: boolean;
  selectedSorts?: SortType[];
  filters?: FilterState;
  mythosMode?: boolean;
  visible: boolean;
  toggleMythosMode: () => void;
  clearSearchFilters: () => void;

  investigator?: Card;
  headerItems?: React.ReactNode[];
  headerHeight?: number;
  mode?: 'story' | 'side' | 'extra';

  initialSort?: SortType;
  includeDuplicates?: boolean;
  filterId: string;
}

function searchOptionsHeight(fontScale: number) {
  return 20 + (fontScale * 20 + 8) * 3 + 12;
}

const FILTER_BUILDER = new FilterBuilder('filters');

interface SearchState {
  searchCode?: number;
  searchQuery?: RegExp;
}

function SearchOptions({
  searchText,
  searchFlavor,
  searchBack,
  toggleSearchText,
  toggleSearchFlavor,
  toggleSearchBack,
}: {
  searchText: boolean;
  searchFlavor: boolean;
  searchBack: boolean;
  toggleSearchText: () => void;
  toggleSearchFlavor: () => void;
  toggleSearchBack: () => void;
}) {
  const { colors, typography } = useContext(StyleContext);
  return (
    <>
      <View style={[styles.column, { alignItems: 'center', flex: 1 }]}>
        <Text style={[typography.large, { color: colors.M, fontFamily: 'Alegreya-Bold' }]}>
          { t`Search in:` }
        </Text>
      </View>
      <View style={styles.column}>
        <View style={styles.row}>
          <Text style={[typography.searchLabel, styles.searchOption, typography.dark]}>
            { t`Game Text` }
          </Text>
          <ArkhamSwitch
            value={searchText}
            onValueChange={toggleSearchText}
          />
        </View>
        <View style={styles.row}>
          <Text style={[typography.searchLabel, styles.searchOption, typography.dark]}>
            { t`Flavor Text` }
          </Text>
          <ArkhamSwitch
            value={searchFlavor}
            onValueChange={toggleSearchFlavor}
          />
        </View>
        <View style={styles.row}>
          <Text style={[typography.searchLabel, styles.searchOption, typography.dark]}>
            { t`Card Backs` }
          </Text>
          <ArkhamSwitch
            value={searchBack}
            onValueChange={toggleSearchBack}
          />
        </View>
      </View>
    </>
  );
}

function useExpandModesButtons({
  hasFilters,
  mythosToggle,
  toggleMythosMode,
  clearSearchFilters,
  mythosMode,
}: {
  hasFilters: boolean;
  mythosToggle?: boolean;
  toggleMythosMode: () => void;
  clearSearchFilters: () => void;
  mythosMode?: boolean;
}): [React.ReactNode, number] {
  if (!mythosToggle && !hasFilters) {
    return [null, 0];
  }
  return [(
    <View key="mode_buttons">
      { !!mythosToggle && (
        <ArkhamButton
          icon="search"
          onPress={toggleMythosMode}
          title={mythosMode ? t`Search player cards` : t`Search encounter cards`}
        />
      ) }
      { !!hasFilters && (
        <ArkhamButton
          icon="filter-clear"
          onPress={clearSearchFilters}
          title={t`Clear search filters`}
        />
      ) }
    </View>
  ), (mythosToggle ? 1 : 0) + (hasFilters ? 1 : 0)];
}

function useExpandSearchButtons({
  hasFilters,
  mythosToggle,
  toggleMythosMode,
  clearSearchFilters,
  mythosMode,
  searchTerm,
  searchText,
  searchBack,
  clearSearchTerm,
  toggleSearchText,
  toggleSearchBack,
}: {
  hasFilters: boolean;
  mythosToggle?: boolean;
  toggleMythosMode: () => void;
  clearSearchFilters: () => void;
  searchText: boolean;
  searchTerm?: string;
  searchBack: boolean;
  mythosMode?: boolean;
  clearSearchTerm: () => void;
  toggleSearchText: () => void;
  toggleSearchBack: () => void;
}): [React.ReactNode, number] {
  const [expandModes, expandModesCount] = useExpandModesButtons({ hasFilters, mythosToggle, toggleMythosMode, clearSearchFilters, mythosMode });
  if (!searchTerm) {
    return [expandModes, expandModesCount];
  }
  return [(
    <View key="expand_buttons">
      { !!searchTerm && (
        <ArkhamButton
          icon="search"
          onPress={clearSearchTerm}
          title={t`Clear "${searchTerm}" search`}
        />
      ) }
      { !searchText && (
        <ArkhamButton
          icon="search"
          onPress={toggleSearchText}
          title={t`Search game text`}
        />
      ) }
      { !searchBack && (
        <ArkhamButton
          icon="search"
          onPress={toggleSearchBack}
          title={t`Search card backs`}
        />
      ) }
      { expandModes }
    </View>
  ), expandModesCount + (!searchTerm ? 1 : 0) + (!searchTerm ? 1 : 0) + (!searchBack ? 1 : 0)];
}

const EMPTY_SEARCH_STATE: SearchState = {};

export default function({
  componentId,
  deckId,
  baseQuery,
  mythosToggle,
  showNonCollection,
  selectedSorts,
  filters,
  mythosMode,
  toggleMythosMode,
  clearSearchFilters,
  investigator,
  headerItems,
  headerHeight,
  mode,
  initialSort,
  includeDuplicates,
  filterId,
}: Props) {
  const { fontScale, colors } = useContext(StyleContext);
  const { lang, useCardTraits } = useContext(LanguageContext);
  const [searchText, setSearchText] = useState(false);
  const [searchFlavor, setSearchFlavor] = useState(false);
  const [searchBack, setSearchBack] = useState(false);
  const customContent = useSettingValue('custom_content');
  const searchEnglish = useSettingValue('search_english');
  const showCustomContent = customContent && (!deckId || deckId.local);
  const [searchTerm, setSearchTerm] = useState<string | undefined>(undefined);
  const [searchState, setSearchState] = useState<SearchState>(EMPTY_SEARCH_STATE);
  const toggleSearchText = useCallback(() => setSearchText(!searchText), [searchText]);
  const toggleSearchFlavor = useCallback(() => setSearchFlavor(!searchFlavor), [searchFlavor]);
  const toggleSearchBack = useCallback(() => setSearchBack(!searchBack), [searchBack]);
  useDebouncedEffect(() => {
    if (!searchTerm) {
      setSearchState(EMPTY_SEARCH_STATE);
      return;
    }
    const searchCode = DIGIT_REGEX.test(searchTerm) ? parseInt(searchTerm, 10) : undefined;
    const term = searchTerm.replace(/“|”/g, '"').replace(/‘|’/, '\'');
    setSearchState({
      searchQuery: new RegExp(`.*${RegexEscape(term)}.*`, 'i'),
      searchCode,
    });
  }, [searchTerm, setSearchState], 200);
  const clearSearchTerm = useCallback(() => setSearchTerm(''), [setSearchTerm]);

  const textQuery = useMemo(() => {
    const {
      searchCode,
    } = searchState;
    const parts: Brackets[] = [];
    if (searchCode) {
      parts.push(where(`c.position = :searchCode`, { searchCode }));
    }
    if (searchTerm === '' || !searchTerm) {
      return combineQueriesOpt(parts, 'and');
    }
    const safeSearchTerm = `%${searchNormalize(searchTerm, lang)}%`;
    const searchRealName = lang !== 'en' && searchEnglish;
    parts.push(where(
      searchRealName ?
        '(c.s_search_name like :searchTerm OR c.s_search_real_name like :searchTerm)' :
        'c.s_search_name like :searchTerm',
      { searchTerm: safeSearchTerm }
    ));
    if (searchBack) {
      parts.push(where([
        searchRealName ? 'c.s_search_name_back like :searchTerm OR c.s_search_real_name_back like :searchTerm' : 'c.s_search_name_back like :searchTerm',
        searchRealName ? '(c.linked_card is not null AND (linked_card.s_search_name like :searchTerm OR linked_card.s_search_real_name like :searchTerm))' : '(c.linked_card is not null AND linked_card.s_search_name like :searchTerm)',
        searchRealName ? '(c.linked_card is not null AND (linked_card.s_search_name_back like :searchTerm OR linked_card.s_search_real_name_back like :searchTerm))' : '(c.linked_card is not null AND linked_card.s_search_name_back like :searchTerm)',
      ].join(' OR '), { searchTerm: safeSearchTerm }
      ));
    }
    if (searchText) {
      parts.push(where('c.s_search_game like :searchTerm', { searchTerm: safeSearchTerm }));
      if (searchBack) {
        parts.push(where([
          'c.s_search_game_back like :searchTerm',
          '(c.linked_card is not null AND linked_card.s_search_game like :searchTerm)',
          '(c.linked_card is not null AND linked_card.s_search_game_back like :searchTerm)',
        ].join(' OR '), { searchTerm: safeSearchTerm }));
      }
    }
    if (searchFlavor) {
      parts.push(where('(c.s_search_flavor like :searchTerm)', { searchTerm: safeSearchTerm }));
      if (searchBack) {
        parts.push(where([
          '(c.s_search_flavor_back like :searchTerm)',
          '(c.linked_card is not null AND linked_card.s_search_flavor like :searchTerm)',
          '(c.linked_card is not null AND linked_card.s_search_flavor_back like :searchTerm)',
        ].join(' OR '), { searchTerm: safeSearchTerm }));
      }
    }
    return combineQueriesOpt(parts, 'or');
  }, [searchState, searchBack, searchFlavor, searchText, searchTerm, lang, searchEnglish]);

  const controls = (
    <SearchOptions
      searchText={searchText}
      searchFlavor={searchFlavor}
      searchBack={searchBack}
      toggleSearchText={toggleSearchText}
      toggleSearchFlavor={toggleSearchFlavor}
      toggleSearchBack={toggleSearchBack}
    />
  );

  const query = useMemo(() => {
    const queryParts: Brackets[] = [];
    const actuallyIncludeDuplicates = includeDuplicates;
    if (mythosToggle) {
      if (mythosMode) {
        queryParts.push(MYTHOS_CARDS_QUERY);
      } else {
        if (actuallyIncludeDuplicates) {
          queryParts.push(BROWSE_CARDS_WITH_DUPLICATES_QUERY);
        } else {
          queryParts.push(BROWSE_CARDS_QUERY);
        }
      }
    }
    if (baseQuery) {
      queryParts.push(baseQuery(filters));
    }
    if (find(selectedSorts, s => s === SORT_BY_ENCOUNTER_SET)) {
      // queryParts.push(where(`c.encounter_code is not null OR linked_card.encounter_code is not null`));
    }
    if (!showCustomContent) {
      queryParts.push(NO_CUSTOM_CARDS_QUERY);
    }
    if (!actuallyIncludeDuplicates) {
      queryParts.push(NO_DUPLICATES_QUERY);
    }
    return combineQueries(
      BASIC_QUERY,
      queryParts,
      'and'
    );
  }, [baseQuery, filters, mythosToggle, selectedSorts, mythosMode, includeDuplicates, showCustomContent]);
  const filterQuery = useMemo(() => filters && FILTER_BUILDER.filterToQuery(filters, useCardTraits), [filters, useCardTraits]);
  const [hasFilters, showFiltersPress] = useFilterButton({ componentId, filterId, baseQuery });
  const renderFabIcon = useCallback(() => (
    <View style={styles.relative}>
      <AppIcon name="filter" color={colors.L30} size={24} />
      { hasFilters && <View style={styles.chiclet} /> }
    </View>
  ), [colors, hasFilters]);
  const backPressed = useCallback(() => Navigation.pop(componentId), [componentId]);
  const [expandSearchControls, expandSearchControlsHeight] = useExpandSearchButtons({
    hasFilters: !!filterQuery,
    mythosToggle,
    toggleMythosMode,
    clearSearchFilters,
    mythosMode,
    searchTerm,
    searchText,
    searchBack,
    clearSearchTerm,
    toggleSearchText,
    toggleSearchBack,
  });
  const parsedDeck = useParsedDeck(deckId, componentId);
  return (
    <CollapsibleSearchBox
      prompt={t`Search for a card`}
      advancedOptions={{
        controls,
        height: searchOptionsHeight(fontScale),
      }}
      searchTerm={searchTerm || ''}
      onSearchChange={setSearchTerm}
    >
      { (handleScroll, showHeader) => (
        <>
          <DbCardResultList
            componentId={componentId}
            parsedDeck={parsedDeck}
            filterId={filterId}
            query={query}
            filters={filters}
            filterQuery={filterQuery || undefined}
            textQuery={textQuery}
            searchTerm={searchTerm}
            sorts={selectedSorts}
            investigator={investigator}
            handleScroll={handleScroll}
            showHeader={showHeader}
            expandSearchControls={expandSearchControls}
            expandSearchControlsHeight={expandSearchControlsHeight * ArkhamButton.computeHeight(fontScale, lang)}
            headerItems={headerItems}
            headerHeight={headerHeight}
            showNonCollection={showNonCollection}
            storyOnly={mode === 'story'}
            specialMode={(mode === 'side' || mode === 'extra') ? mode : undefined}
            mythosToggle={mythosToggle}
            initialSort={initialSort}
            footerPadding={deckId !== undefined ? DeckNavFooter.height : undefined}
          />
          { !!parsedDeck && (
            <>
              <PreLoadedDeckNavFooter
                componentId={componentId}
                parsedDeckObj={parsedDeck}
                control="fab"
                onPress={backPressed}
                mode={mode === 'extra' ? 'extra' : undefined}
              />
              <ActionButton
                buttonColor={colors.D10}
                renderIcon={renderFabIcon}
                onPress={showFiltersPress}
                offsetX={s + xs}
                offsetY={NOTCH_BOTTOM_PADDING + s + xs}
              />
            </>
          ) }
        </>
      ) }
    </CollapsibleSearchBox>
  );
}

const styles = StyleSheet.create({
  column: {
    flexDirection: 'column',
    alignItems: 'flex-end',
    justifyContent: 'flex-start',
  },
  searchOption: {
    marginLeft: s,
    marginRight: xs,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  relative: {
    position: 'relative',
  },
  chiclet: {
    position: 'absolute',
    top: -12,
    right: -14,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: 'red',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
