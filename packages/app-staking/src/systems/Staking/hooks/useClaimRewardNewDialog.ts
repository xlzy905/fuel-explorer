import { useQueryClient } from '@tanstack/react-query';
import { useInterpret, useSelector } from '@xstate/react';
import { useCallback, useEffect } from 'react';
import { usePublicClient, useWalletClient } from 'wagmi';
import type { SequencerValidatorAddress } from '~staking/systems/Core/utils/address';
import {
  claimRewardNewMachine,
  claimRewardNewMachineSelectors,
} from '../machines/claimRewardNewDialogMachine';

export function useClaimRewardNewDialog({
  validator,
}: { validator: SequencerValidatorAddress }) {
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const queryClient = useQueryClient();

  const isReady = !!walletClient;

  const service = useInterpret(claimRewardNewMachine);

  useEffect(() => {
    if (validator) {
      service.send({
        type: 'SET_VALIDATOR',
        validator,
      });
    }
  }, [validator, service]);

  useEffect(() => {
    if (publicClient && walletClient && queryClient) {
      service.send({
        type: 'SET_CLIENTS',
        publicClient,
        walletClient,
        queryClient,
      });
    }
  }, [publicClient, walletClient, service, queryClient]);

  const onConfirm = useCallback(() => {
    service.send({ type: 'CONFIRM' });
  }, [service]);

  const isSubmitting = useSelector(service, (state) =>
    claimRewardNewMachineSelectors.isSubmitting(state),
  );

  const isReviewing = useSelector(service, (state) =>
    claimRewardNewMachineSelectors.isReviewing(state),
  );

  const claimRewardError = useSelector(service, (state) =>
    claimRewardNewMachineSelectors.getClaimRewardError(state.context),
  );

  const isGettingReviewDetails = useSelector(
    service,
    claimRewardNewMachineSelectors.isGettingReviewDetails,
  );

  const fee = useSelector(service, (state) => state.context.fee);
  const rates = useSelector(service, (state) => state.context.rates);

  return {
    state: useSelector(service, (state) => state),
    send: service.send,
    isReady,
    isSubmitting,
    isReviewing,
    isGettingReviewDetails,
    onConfirm,
    fee,
    rates,
    onClose: () => service.send({ type: 'CLOSE' }),
    claimRewardError,
  };
}
