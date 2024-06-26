import { useEffect } from 'react';
import { Services, store } from '~portal/store';

import {
  type EcosystemInputs,
  type EcosystemMachineState,
  sortAtoZ,
} from '../machines';
import type { Project } from '../types';

const sortProjects = (a: Project, b: Project) => {
  if (a.isLive && !b.isLive) return -1;
  if (!a.isLive && b.isLive) return 1;

  return sortAtoZ(a.name, b.name);
};

const selectors = {
  filteredProjects: (state: EcosystemMachineState) => {
    const { projects = [], search, filter } = state.context;

    if (search) {
      const filtered = projects.filter((project) => {
        return project.name.toLowerCase().includes(search.toLowerCase());
      });
      return filtered.sort(sortProjects);
    }

    if (filter) {
      const filtered = projects.filter((project) => {
        return project.tags.includes(filter);
      });
      return filtered.sort(sortProjects);
    }

    return projects.sort(sortProjects);
  },
  tags: (state: EcosystemMachineState) => state.context?.tags,
  filter: (state: EcosystemMachineState) => state.context?.filter,
  search: (state: EcosystemMachineState) => state.context?.search,
  isLoading: (state: EcosystemMachineState) => state.hasTag('isLoading'),
};

export function useEcosystem() {
  const tags = store.useSelector(Services.ecosystem, selectors.tags);
  const filteredProjects = store.useSelector(
    Services.ecosystem,
    selectors.filteredProjects,
  );
  const filter = store.useSelector(Services.ecosystem, selectors.filter);
  const search = store.useSelector(Services.ecosystem, selectors.search);
  const isLoading = store.useSelector(Services.ecosystem, selectors.isLoading);

  useEffect(() => {
    store.send(Services.ecosystem, {
      type: 'FETCH_PROJECTS_AND_TAGS',
      input: null,
    });
  }, []);

  const filterProjects = (input: EcosystemInputs['filter']) => {
    store.send(Services.ecosystem, { type: 'FILTER', input });
  };

  const searchProjects = (input: EcosystemInputs['search']) => {
    store.send(Services.ecosystem, { type: 'SEARCH', input });
  };

  const clearFilters = () => {
    store.send(Services.ecosystem, { type: 'CLEAR_FILTER', input: null });
  };

  return {
    filteredProjects,
    tags,
    filter,
    search,
    isLoading,
    handlers: {
      filterProjects,
      searchProjects,
      clearFilters,
    },
  };
}
